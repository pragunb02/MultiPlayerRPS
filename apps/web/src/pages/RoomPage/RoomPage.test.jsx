import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };
const ME = { playerId: GUEST.id, displayName: GUEST.displayName, connected: true };
const roomView = (overrides = {}) => ({
  code: "AB2CD3",
  gameId: "tictactoe",
  status: "waiting",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME],
  you: GUEST.id,
  ...overrides,
});
// A game with no board in the client registry, to exercise the generic room page (fallback board).
const playing = (overrides = {}) =>
  roomView({
    gameId: "ludo",
    status: "playing",
    seats: [ME, BOB],
    game: { view: {}, activePlayers: [GUEST.id], outcome: { status: "ongoing" } },
    ...overrides,
  });

/** Renders the room AB2CD3 as a signed-in guest whose socket answers room:join with `joined`. */
function openRoom({ joined = roomView(), connected = true, path = `/games/tic-tac-toe/rooms/AB2CD3` } = {}) {
  const socket = fakeSocket();
  if (connected) socket.connect();
  socket.request.mockImplementation(async (event) => {
    if (event === "room:join") {
      if (joined instanceof Error) throw joined;
      return joined;
    }
    return { left: true };
  });
  const view = renderApp({ path, socket, api: fakeApi({ getSession: async () => GUEST }) });
  return { ...view, socket };
}

describe("RoomPage", () => {
  it("waits for players with an invite and the seat list", async () => {
    openRoom();

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      `${window.location.origin}/games/tic-tac-toe/rooms/AB2CD3`,
    );
    expect(screen.getByRole("list", { name: "Players" })).toHaveTextContent("Waiting for a player…");
  });

  it("starts a guest session first when opened from a shared link", async () => {
    const socket = fakeSocket();
    socket.request.mockResolvedValue(roomView());
    const { api } = renderApp({ path: "/games/tic-tac-toe/rooms/AB2CD3", socket });

    await vi.waitFor(() => expect(api.startGuest).toHaveBeenCalledOnce());
    act(() => socket.push("connect"));

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
  });

  it("follows pushed updates for this room only", async () => {
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    act(() => socket.push("room:updated", playing({ code: "OTHER2" })));
    expect(screen.getByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();

    act(() => socket.push("room:updated", playing()));
    expect(await screen.findByText(/board is not available yet/)).toBeInTheDocument();
  });

  it("loads the game's own board when the game has one", async () => {
    openRoom({
      joined: playing({
        gameId: "tictactoe",
        game: {
          view: {
            board: Array(9).fill(""),
            marks: { [GUEST.id]: "X", guest_b: "O" },
            turn: GUEST.id,
            winningLine: [],
          },
          activePlayers: [GUEST.id],
          outcome: { status: "ongoing" },
        },
      }),
    });

    expect(await screen.findByRole("grid", { name: "Tic-Tac-Toe board" })).toBeInTheDocument();
  });

  it.each([
    [{ result: "win", winners: [GUEST.id], reason: "three-in-a-row" }, "You won!"],
    [{ result: "win", winners: ["guest_b"], reason: "three-in-a-row" }, "You lost"],
    [{ result: "draw", winners: [], reason: "board-full" }, "It's a draw"],
  ])("shows the result from your point of view (%o)", async (outcome, text) => {
    openRoom({ joined: playing({ status: "finished", game: { view: {}, activePlayers: [], outcome } }) });

    expect(await screen.findByRole("heading", { name: text })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play again" })).toHaveAttribute("href", "/games/ludo");
  });

  it("explains a closed room", async () => {
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    act(() => socket.push("room:closed", { code: "AB2CD3", reason: "expired" }));

    expect(await screen.findByText("This room expired after being idle.")).toBeInTheDocument();
  });

  it.each([
    [new AppRequestError({ code: "NOT_FOUND", message: "Room not found" }), "Room not found"],
    [new AppRequestError({ code: "CONFLICT", message: "Room is full" }), "Can't join this room"],
  ])("explains why joining failed (%s)", async (error, heading) => {
    openRoom({ joined: error });

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("rejoins after the connection comes back", async () => {
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    act(() => socket.push("connect"));

    await vi.waitFor(() =>
      expect(socket.request.mock.calls.filter(([event]) => event === "room:join")).toHaveLength(2),
    );
  });

  it("asks before leaving a game in progress, then forfeits and returns to the lobby", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom({ joined: playing() });
    await screen.findByText(/board is not available yet/);

    await user.click(screen.getByRole("button", { name: "Leave room" }));
    expect(screen.getByRole("dialog", { name: "Leave the game?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(socket.request).not.toHaveBeenCalledWith("room:leave", expect.anything());

    await user.click(screen.getByRole("button", { name: "Leave room" }));
    await user.click(screen.getByRole("button", { name: "Leave and forfeit" }));

    expect(socket.request).toHaveBeenCalledWith("room:leave", { code: "AB2CD3" });
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument(); // /games/ludo
  });

  it("leaves a waiting room without asking", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    await user.click(screen.getByRole("button", { name: "Leave room" }));

    expect(socket.request).toHaveBeenCalledWith("room:leave", { code: "AB2CD3" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("progress toasts", () => {
  it.each([
    [{ xpGained: 30, leveledUp: false, progress: { level: 1 } }, "+30 XP"],
    [{ xpGained: 30, leveledUp: true, progress: { level: 2 } }, "Level up! You reached level 2"],
  ])("announces %o", async (payload, text) => {
    const socket = fakeSocket();
    renderApp({ socket });

    act(() => socket.push("progress:updated", payload));

    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
