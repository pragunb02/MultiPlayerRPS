import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const ME = {
  playerId: GUEST.id,
  displayName: GUEST.displayName,
  connected: true,
  presence: "here",
  graceUntil: 0,
};
const BOB = { playerId: "guest_b", displayName: "Bob", connected: true, presence: "here", graceUntil: 0 };
const WIN = { status: "finished", result: "win", winners: [GUEST.id], reason: "reached-target" };

// The server's clock when it sent the view, and the end of the rematch window 12 min 34 s later.
const SERVER_T = 7_000_000;
const UNTIL = SERVER_T + 12 * 60_000 + 34_000;
const rematchRequest = ({ from = BOB.playerId, to = GUEST.id, state = "open" } = {}) => ({
  type: "rematch",
  from,
  to,
  createdAt: SERVER_T,
  expiresAt: SERVER_T + 60_000,
  state,
  endedAt: state === "open" ? 0 : SERVER_T + 1,
});
const MINE = rematchRequest({ from: GUEST.id, to: BOB.playerId });

/** A finished game of a board-less game (generic room page), from the guest's seat. */
const finished = ({ rematch = { available: true, until: UNTIL }, ...overrides } = {}) => ({
  code: "AB2CD3",
  gameId: "ludo",
  status: "finished",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  requests: [],
  requestsLeft: {},
  askAgainAt: {},
  game: { view: {}, activePlayers: [], outcome: WIN, number: 1, turnEndsAt: 0 },
  ...(rematch && { rematch }),
  series: { games: 1, wins: { [GUEST.id]: 1 } },
  serverTime: SERVER_T,
  ...overrides,
});

/** Opens the room; the socket answers room:join with `joined`, and room:request and room:answer with `onRequest()`. */
function openRoom(joined, onRequest = vi.fn(async () => joined)) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event, payload) => {
    if (event === "room:join") return joined;
    if (event === "room:request" || event === "room:answer") return onRequest(event, payload);
    return { left: true };
  });
  const view = renderApp({
    path: "/games/ludo/rooms/AB2CD3",
    socket,
    api: fakeApi({ getSession: async () => GUEST }),
  });
  return { ...view, socket, onRequest };
}

describe("RoomPage rematch (CC-037, CC-159)", () => {
  it("offers a rematch after the game, and waits for the opponent once asked", async () => {
    const user = userEvent.setup();
    const { socket, onRequest } = openRoom(
      finished(),
      vi.fn(async () => finished({ requests: [MINE] })),
    );

    await user.click(await screen.findByRole("button", { name: "Rematch" }));

    expect(socket.request).toHaveBeenCalledWith("room:request", { code: "AB2CD3", type: "rematch" });
    expect(onRequest).toHaveBeenCalledOnce();
    expect(await screen.findByText("Waiting for Bob…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel rematch" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for Bob to answer your rematch request")).toBeInTheDocument();
  });

  it("withdraws the request on cancel", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(
      finished({ requests: [MINE] }),
      vi.fn(async () => finished({ requests: [{ ...MINE, state: "withdrawn", endedAt: SERVER_T + 1 }] })),
    );

    await user.click(await screen.findByRole("button", { name: "Cancel rematch" }));

    expect(socket.request).toHaveBeenCalledWith("room:answer", {
      code: "AB2CD3",
      type: "rematch",
      answer: "withdraw",
    });
    expect(await screen.findByRole("button", { name: "Rematch" })).toBeInTheDocument();
  });

  it("shows the opponent's request and starts the new game in place when accepted", async () => {
    const user = userEvent.setup();
    const playing = finished({
      status: "playing",
      rematch: undefined,
      seats: [BOB, ME],
      game: { view: {}, activePlayers: [GUEST.id], outcome: { status: "ongoing" }, number: 2, turnEndsAt: 0 },
    });
    const view = openRoom(
      finished(),
      vi.fn(async () => playing),
    );
    await screen.findByRole("heading", { name: "You won!" });

    act(() => view.socket.push("room:updated", finished({ requests: [rematchRequest()] })));
    expect(await screen.findByText("Bob wants a rematch!")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept rematch" }));

    expect(view.socket.request).toHaveBeenCalledWith("room:answer", {
      code: "AB2CD3",
      type: "rematch",
      answer: "accept",
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "You won!" })).not.toBeInTheDocument());
    expect(screen.getByText(/board is not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rematch/i })).not.toBeInTheDocument();
    expect(view.url()).toBe("/games/ludo/rooms/AB2CD3");
  });

  it("replaces the last game's board with a fresh one for the rematch", async () => {
    const user = userEvent.setup();
    const board = (cells, turn) => ({
      board: cells,
      marks: { [GUEST.id]: "X", [BOB.playerId]: "O" },
      turn,
      winningLine: [],
    });
    const won = finished({
      gameId: "tictactoe",
      game: {
        view: board(["X", "X", "X", "O", "O", "", "", "", ""], ""),
        activePlayers: [],
        outcome: WIN,
        number: 1,
        turnEndsAt: 0,
      },
    });
    const rematch = finished({
      gameId: "tictactoe",
      status: "playing",
      rematch: undefined,
      seats: [BOB, ME],
      game: {
        view: board(Array(9).fill(""), BOB.playerId),
        activePlayers: [BOB.playerId],
        outcome: { status: "ongoing" },
        number: 2,
        turnEndsAt: 0,
      },
    });
    openRoom(
      won,
      vi.fn(async () => rematch),
    );
    // Marks are drawn (CC-087); each cell's name says what is in it.
    const marks = () =>
      screen.getAllByRole("gridcell").map((cell) => cell.getAttribute("aria-label").split(": ")[1]);
    await screen.findByRole("grid", { name: "Tic-Tac-Toe board" });
    expect(marks().join("")).toBe("XXXOOemptyemptyemptyempty");

    await user.click(screen.getByRole("button", { name: "Rematch" }));

    await waitFor(() => expect(marks().every((mark) => mark === "empty")).toBe(true));
  });

  it("says when the opponent left, and offers a new opponent instead", async () => {
    openRoom(finished({ rematch: { available: false, until: UNTIL }, seats: [ME] }));

    expect(
      await screen.findByText("Your opponent left, so there is no rematch this time."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New opponent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
  });

  it("names the opponent who left the finished game (CC-162)", async () => {
    openRoom(finished({ rematch: { available: false, until: UNTIL, leftName: "Bob" }, seats: [ME] }));

    expect(await screen.findByText("Bob left, so there is no rematch this time.")).toBeInTheDocument();
  });

  it("mentions an opponent who is offline", async () => {
    openRoom(finished({ seats: [ME, { ...BOB, connected: false, presence: "offline" }] }));

    expect(await screen.findByText("Bob is offline right now.")).toBeInTheDocument();
  });

  it("says when the last request got no answer, and asking again stays possible", async () => {
    openRoom(finished({ requests: [{ ...MINE, state: "expired", endedAt: SERVER_T + 60_000 }] }));

    expect(await screen.findByText("No answer from Bob.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument();
  });

  it("says a game was aborted, calmly, and still offers a rematch (CC-036)", async () => {
    const aborted = { status: "finished", result: "aborted", winners: [], reason: "aborted" };
    openRoom(finished({ game: { view: {}, activePlayers: [], outcome: aborted, number: 1, turnEndsAt: 0 } }));

    expect(
      await screen.findByRole("heading", { name: "Game aborted: the first move did not come in time" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument();
  });

  it("shows the series score once there was a rematch", async () => {
    openRoom(finished({ series: { games: 3, wins: { [GUEST.id]: 2, [BOB.playerId]: 1 } } }));

    expect(await screen.findByText("You 2 – Bob 1")).toBeInTheDocument();
    expect(screen.getByText(/Series after 3 games/)).toBeInTheDocument();
  });

  it("counts a player without wins in the series as 0", async () => {
    openRoom(finished({ series: { games: 2, wins: { [GUEST.id]: 1 } } }));

    expect(await screen.findByText("You 1 – Bob 0")).toBeInTheDocument();
  });

  it("explains a refused request", async () => {
    const user = userEvent.setup();
    openRoom(
      finished(),
      vi.fn(async () => {
        throw new AppRequestError({
          code: "CONFLICT",
          message: "Your opponent left, so a rematch is no longer possible",
        });
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Rematch" }));

    expect(
      await screen.findByText("Your opponent left, so a rematch is no longer possible"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeEnabled();
  });

  it("offers spectators no rematch", async () => {
    openRoom(finished({ you: "" }));

    expect(await screen.findByRole("heading", { name: "Guest-T001 won" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
  });

  it("offers nothing when the server sent no rematch state", async () => {
    openRoom(finished({ rematch: null, series: undefined }));

    expect(await screen.findByRole("heading", { name: "You won!" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
  });

  it("shows how long a rematch is still possible, counting down", async () => {
    openRoom(finished());

    expect(await screen.findByText(/Rematch available for/)).toHaveTextContent("Rematch available for 12:34");
  });

  it("shows no countdown once the opponent left", async () => {
    openRoom(finished({ rematch: { available: false, until: UNTIL } }));

    await screen.findByText("Your opponent left, so there is no rematch this time.");
    expect(screen.queryByText(/Rematch available for/)).not.toBeInTheDocument();
  });

  it("asks the server again when the rematch window ends, and explains that the room closed", async () => {
    const socket = fakeSocket();
    socket.connect();
    let joins = 0;
    socket.request.mockImplementation(async (event) => {
      if (event !== "room:join") return { left: true };
      joins++;
      if (joins === 1) return finished({ rematch: { available: true, until: SERVER_T + 1_000 } });
      throw new AppRequestError({
        code: "GONE",
        message: "This room has closed",
        details: { reason: "rematch-window-ended", gameId: "tictactoe", closedAt: SERVER_T + 1_000 },
      });
    });
    renderApp({ path: "/games/ludo/rooms/AB2CD3", socket, api: fakeApi({ getSession: async () => GUEST }) });
    expect(await screen.findByText(/Rematch available for/)).toHaveTextContent("0:01");

    expect(
      await screen.findByText("The time for a rematch is over, so the room closed.", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new Tic Tac Toe game" })).toBeInTheDocument();
    expect(joins).toBe(2);
  });

  it("tells the server the player went to another page, so the opponent sees them away (CC-207)", async () => {
    const user = userEvent.setup();
    const view = openRoom(finished());
    await screen.findByRole("heading", { name: "You won!" });

    await user.click(screen.getByRole("link", { name: "ClassiCade home" }));

    await waitFor(() => expect(view.url()).toBe("/"));
    expect(view.socket.request).toHaveBeenCalledWith("room:away", { code: "AB2CD3" });
  });

  it("does not report away after leaving the seat, or from a page that never held one", async () => {
    const user = userEvent.setup();
    const view = openRoom(finished());
    await user.click(await screen.findByRole("button", { name: "New opponent" }));
    await waitFor(() => expect(view.url()).toBe("/games/ludo"));

    expect(view.socket.request).not.toHaveBeenCalledWith("room:away", expect.anything());
  });

  it("does not report away for a spectator", async () => {
    const user = userEvent.setup();
    const view = openRoom(finished({ you: "" }));
    await screen.findByRole("heading", { name: "Guest-T001 won" });

    await user.click(screen.getByRole("link", { name: "ClassiCade home" }));

    await waitFor(() => expect(view.url()).toBe("/"));
    expect(view.socket.request).not.toHaveBeenCalledWith("room:away", expect.anything());
  });

  it("ignores a refused away, because the page that sent it is gone", async () => {
    const user = userEvent.setup();
    const socket = fakeSocket();
    socket.connect();
    socket.request.mockImplementation(async (event) => {
      if (event === "room:join") return finished();
      throw new AppRequestError({ code: "GONE", message: "This room has closed" });
    });
    const view = renderApp({
      path: "/games/ludo/rooms/AB2CD3",
      socket,
      api: fakeApi({ getSession: async () => GUEST }),
    });
    await screen.findByRole("heading", { name: "You won!" });

    await user.click(screen.getByRole("link", { name: "ClassiCade home" }));

    await waitFor(() => expect(view.url()).toBe("/"));
    expect(socket.request).toHaveBeenCalledWith("room:away", { code: "AB2CD3" });
  });
});
