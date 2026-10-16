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
function openRoom({
  joined = roomView(),
  connected = true,
  path = `/games/tic-tac-toe/rooms/AB2CD3`,
  history = [],
} = {}) {
  const socket = fakeSocket();
  if (connected) socket.connect();
  socket.request.mockImplementation(async (event) => {
    if (event === "room:join") {
      if (joined instanceof Error) throw joined;
      return joined;
    }
    return { left: true };
  });
  const view = renderApp({ path, history, socket, api: fakeApi({ getSession: async () => GUEST }) });
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

describe("RoomPage: every other state and path", () => {
  it("leaving replaces the room in history, so Back doesn't lead into the room you left", async () => {
    const user = userEvent.setup();
    const { socket, url, back, forward } = openRoom({ history: ["/", "/games/tic-tac-toe"] });
    await screen.findByRole("heading", { name: "Invite a friend" });

    await user.click(screen.getByRole("button", { name: "Leave room" }));
    await vi.waitFor(() => expect(url()).toBe("/games/tic-tac-toe"));

    back();
    expect(url()).toBe("/games/tic-tac-toe");
    back();
    expect(url()).toBe("/");
    forward();
    forward();
    expect(url()).toBe("/games/tic-tac-toe");
    expect(socket.request.mock.calls.filter(([event]) => event === "room:join")).toHaveLength(1);
  });

  it("keeps you in the room and says why when leaving fails", async () => {
    const user = userEvent.setup();
    const { socket, url } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });
    socket.request.mockImplementation(async (event) => {
      if (event === "room:leave")
        throw new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade" });
      return roomView();
    });

    await user.click(screen.getByRole("button", { name: "Leave room" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Can't reach ClassiCade");
    expect(url()).toBe("/games/tic-tac-toe/rooms/AB2CD3");
  });

  it("closing the leave dialog with Escape keeps you in the game", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom({ joined: playing() });
    await screen.findByText(/board is not available yet/);

    await user.click(screen.getByRole("button", { name: "Leave room" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(socket.request).not.toHaveBeenCalledWith("room:leave", expect.anything());
  });

  it.each([
    [{ result: "win", winners: ["guest_b"] }, "Bob won"],
    [{ result: "win", winners: ["guest_gone"] }, "Someone won"],
  ])("tells a spectator who won (%o)", async (outcome, text) => {
    openRoom({
      joined: playing({ you: "", status: "finished", game: { view: {}, activePlayers: [], outcome } }),
    });

    expect(await screen.findByRole("heading", { name: text })).toBeInTheDocument();
  });

  it("explains a room closed for a reason this build doesn't know", async () => {
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    act(() => socket.push("room:closed", { code: "AB2CD3", reason: "maintenance" }));

    expect(await screen.findByText("This room has been closed.")).toBeInTheDocument();
    expect(document.title).toBe("Room closed · ClassiCade");
  });

  it("ignores another room closing", async () => {
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    act(() => socket.push("room:closed", { code: "OTHER2", reason: "expired" }));

    expect(screen.getByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
  });

  it("waits for the connection before joining", async () => {
    const socket = fakeSocket();
    socket.connect.mockImplementation(() => {}); // asked to connect, still connecting
    socket.request.mockResolvedValue(roomView());
    renderApp({
      path: "/games/tic-tac-toe/rooms/AB2CD3",
      socket,
      api: fakeApi({ getSession: async () => GUEST }),
    });
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalled());
    await screen.findByText(/Joining room AB2CD3/);
    expect(socket.request).not.toHaveBeenCalledWith("room:join", expect.anything());

    act(() => socket.push("connect"));

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
  });

  it("explains when no guest session can be started for a shared link", async () => {
    renderApp({
      path: "/games/tic-tac-toe/rooms/AB2CD3",
      api: fakeApi({
        startGuest: async () => {
          throw new AppRequestError({ code: "RATE_LIMITED", message: "Too many requests, try again later" });
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Can't join this room" })).toBeInTheDocument();
    expect(screen.getByText("Too many requests, try again later")).toBeInTheDocument();
    expect(document.title).toBe("Can't join this room · ClassiCade");
  });

  it("sends a move and shows the board the server answers with", async () => {
    const user = userEvent.setup();
    const ttt = (board, turn) => ({
      ...roomView({ status: "playing", seats: [ME, BOB] }),
      game: {
        view: { board, marks: { [GUEST.id]: "X", guest_b: "O" }, turn, winningLine: [] },
        activePlayers: [turn],
        outcome: { status: "ongoing" },
      },
    });
    const { socket } = openRoom({ joined: ttt(Array(9).fill(""), GUEST.id) });
    await screen.findByRole("grid", { name: "Tic-Tac-Toe board" });
    socket.request.mockImplementation(async (event, payload) =>
      event === "game:move" ? ttt(["X", "", "", "", "", "", "", "", ""], "guest_b") : payload,
    );

    await user.click(screen.getByRole("gridcell", { name: "top left: empty" }));

    expect(socket.request).toHaveBeenCalledWith("game:move", { code: "AB2CD3", move: { cell: 0 } });
    expect(await screen.findByRole("gridcell", { name: "top left: X" })).toBeDisabled();
    expect(screen.getByText("Waiting for Bob")).toBeInTheDocument();
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

  it("stays quiet for a match that earned no XP", async () => {
    const socket = fakeSocket();
    renderApp({ socket });
    await screen.findByRole("heading", { name: /Play the classics/ });

    act(() => socket.push("progress:updated", { xpGained: 0, leveledUp: false, progress: { level: 1 } }));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each([
    ["/games/tic-tac-toe/rooms/AB2CD3", true],
    ["/room/AB2CD3", false], // an old link names no game
  ])("offers a new game of the room's kind when the room can't be joined (%s)", async (path, offered) => {
    openRoom({
      path,
      joined: new AppRequestError({
        code: "CONFLICT",
        message: "This game has already started",
        status: 409,
      }),
    });

    expect(await screen.findByRole("heading", { name: "Can't join this room" })).toBeInTheDocument();
    const link = screen.queryByRole("link", { name: "Start a new Tic Tac Toe game" });
    if (offered) expect(link).toHaveAttribute("href", "/games/tic-tac-toe");
    else expect(link).toBeNull();
  });
});
