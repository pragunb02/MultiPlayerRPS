import { act, screen, waitFor, within } from "@testing-library/react";
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
      `${window.location.origin}/games/tic-tac-toe/rooms/AB2CD3?via=copy`,
    );
    expect(screen.getByRole("list", { name: "Players" })).toHaveTextContent("Waiting for a player…");
  });

  it("says who is away when every seat is taken but the game waits for them (CC-112)", async () => {
    openRoom({
      joined: roomView({ hostId: BOB.playerId, seats: [{ ...BOB, connected: false }, ME] }),
    });

    expect(await screen.findByRole("heading", { name: "Waiting for Bob" })).toBeInTheDocument();
    expect(screen.getByText("Bob is away. The game starts as soon as they are back.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invite a friend" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "New opponent" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Play again" })).not.toBeInTheDocument();
  });

  it.each([
    [{ result: "win", winners: [GUEST.id], reason: "three-in-a-row" }, "You won with three in a row"],
    [{ result: "win", winners: ["guest_b"], reason: "forfeit" }, "You lost by forfeit"],
    [{ result: "win", winners: [GUEST.id], reason: "forfeit" }, "You won by forfeit"],
    [{ result: "draw", winners: [], reason: "board-full" }, "Draw with a full board"],
  ])("names how the game ended in the headline (CC-162, %o)", async (outcome, text) => {
    openRoom({
      joined: roomView({
        status: "finished",
        seats: [ME, BOB],
        game: {
          view: { board: Array(9).fill(""), marks: { [GUEST.id]: "X" }, turn: "", winningLine: [] },
          activePlayers: [],
          outcome,
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: text })).toBeInTheDocument();
  });

  it("puts the result and Rematch above the board, Rematch first (CC-162)", async () => {
    const outcome = { result: "win", winners: [GUEST.id], reason: "three-in-a-row" };
    openRoom({
      joined: playing({
        status: "finished",
        game: { view: {}, activePlayers: [], outcome },
        rematch: { requestedBy: [], available: true, until: Date.now() + 60_000, declinedBy: "" },
        serverTime: Date.now(),
      }),
    });

    const rematch = await screen.findByRole("button", { name: "Rematch" });
    const newOpponent = screen.getByRole("button", { name: "New opponent" });
    const board = screen.getByText(/board is not available yet/);
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(rematch, newOpponent)).toBe(true);
    expect(before(newOpponent, board)).toBe(true);
    expect(rematch).toHaveAttribute("data-cc-control", "room.rematch.ask");
  });

  it("leaves the seat and opens the lobby on New opponent, so Back does not return to the room (CC-162)", async () => {
    const user = userEvent.setup();
    const outcome = { result: "win", winners: [GUEST.id], reason: "three-in-a-row" };
    const { socket, url, back } = openRoom({
      joined: playing({ status: "finished", game: { view: {}, activePlayers: [], outcome } }),
      history: ["/"],
    });

    await user.click(await screen.findByRole("button", { name: "New opponent" }));

    expect(socket.request).toHaveBeenCalledWith("room:leave", { code: "AB2CD3" });
    await vi.waitFor(() => expect(url()).toBe("/games/ludo"));
    back();
    expect(url()).toBe("/");
  });

  it("offers a spectator a game of their own instead of New opponent", async () => {
    const outcome = { result: "win", winners: ["guest_b"], reason: "three-in-a-row" };
    openRoom({
      joined: playing({ you: "", status: "finished", game: { view: {}, activePlayers: [], outcome } }),
    });

    expect(await screen.findByRole("link", { name: "Play a game" })).toHaveAttribute("href", "/games/ludo");
    expect(screen.queryByRole("button", { name: "New opponent" })).not.toBeInTheDocument();
  });

  it.each([
    [{ result: "win", winners: [GUEST.id], reason: "three-in-a-row" }, "Victory!", true],
    [{ result: "win", winners: ["guest_b"], reason: "three-in-a-row" }, "Defeat", false],
  ])("celebrates the result: banner, and confetti for a win (%o)", async (outcome, banner, confetti) => {
    openRoom({ joined: playing({ status: "finished", game: { view: {}, activePlayers: [], outcome } }) });

    expect(await screen.findByText(banner)).toBeInTheDocument();
    expect(Boolean(document.querySelector("[data-effect='confetti']"))).toBe(confetti);
    // The status region still says the result in words; the banner is decoration.
    const result = screen.getByRole("heading", { name: confetti ? "You won!" : "You lost" });
    // The result panel takes the outcome's colour.
    expect(result.closest("section")).toHaveClass(confetti ? "win" : "loss");
  });

  it("shows the game's icon in the room title and invite art while waiting", async () => {
    openRoom();

    const title = await screen.findByRole("heading", { level: 1, name: "Tic Tac Toe" });
    expect(title.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { name: "Invite a friend" }).previousElementSibling.tagName).toBe(
      "svg",
    );
  });

  it("explains a closed room", async () => {
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    act(() => socket.push("room:closed", { code: "AB2CD3", reason: "expired" }));

    expect(await screen.findByText("Nobody joined in time, so the room closed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new Tic Tac Toe game" })).toHaveAttribute(
      "href",
      "/games/tic-tac-toe",
    );
  });

  it.each([
    ["expired", "Nobody joined in time, so the room closed."],
    ["empty", "Everyone left, so the room closed."],
    ["abandoned", "Everyone was away from the game for too long, so the room closed."],
    ["rematch-window-ended", "The time for a rematch is over, so the room closed."],
  ])(
    "explains a link to a room that closed (%s) and offers a new game of the same kind",
    async (reason, text) => {
      // The link names one game, the closed room another: the room's own game is the one offered.
      openRoom({
        path: "/games/tic-tac-toe/rooms/AB2CD3",
        joined: new AppRequestError({
          code: "GONE",
          message: "This room has closed",
          details: { reason, gameId: "chess", closedAt: 1 },
        }),
      });

      expect(await screen.findByRole("heading", { name: "Room closed" })).toBeInTheDocument();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Start a new Chess game" })).toHaveAttribute(
        "href",
        "/games/chess",
      );
      expect(screen.queryByText(/no room with the code/)).not.toBeInTheDocument();
      expect(document.title).toBe("Room closed · ClassiCade");
    },
  );

  it("explains a room that closed while the join was still on its way", async () => {
    const socket = fakeSocket();
    socket.connect();
    renderApp({
      path: "/games/tic-tac-toe/rooms/AB2CD3",
      socket,
      api: fakeApi({ getSession: async () => GUEST }),
    });
    await vi.waitFor(() => expect(socket.request).toHaveBeenCalledWith("room:join", { code: "AB2CD3" }));

    act(() => socket.push("room:closed", { code: "AB2CD3", reason: "abandoned" }));

    expect(
      await screen.findByText("Everyone was away from the game for too long, so the room closed."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new Tic Tac Toe game" })).toBeInTheDocument();
  });

  it("offers the link's game when the closed room's game is not known to this build", async () => {
    openRoom({
      joined: new AppRequestError({
        code: "GONE",
        message: "This room has closed",
        details: { reason: "expired", gameId: "retired-game", closedAt: 1 },
      }),
    });

    expect(await screen.findByRole("link", { name: "Start a new Tic Tac Toe game" })).toBeInTheDocument();
  });

  it("offers no particular game when neither the link nor the room names one", async () => {
    openRoom({
      path: "/room/AB2CD3",
      joined: new AppRequestError({
        code: "GONE",
        message: "This room has closed",
        details: { reason: "expired", gameId: "retired-game", closedAt: 1 },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Room closed" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Start a new/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the games" })).toBeInTheDocument();
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

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach ClassiCade");
    expect(url()).toBe("/games/tic-tac-toe/rooms/AB2CD3");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(socket.request.mock.calls.filter(([event]) => event === "room:leave")).toHaveLength(2);
  });

  it("explains every room control while the connection is being restored (CC-164)", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom();
    await screen.findByRole("heading", { name: "Invite a friend" });

    act(() => socket.push("disconnect"));
    const leave = screen.getByRole("button", { name: "Leave room" });
    await user.click(leave);

    expect(leave).toHaveAttribute("aria-disabled", "true");
    expect(socket.request).not.toHaveBeenCalledWith("room:leave", expect.anything());
    expect(screen.getAllByText("Reconnecting").length).toBeGreaterThan(0);

    act(() => socket.push("connect"));
    expect(screen.getByRole("button", { name: "Leave room" })).not.toHaveAttribute("aria-disabled");
  });

  it("says where the match stands on the page, for tests and telemetry (CC-170)", async () => {
    openRoom({ joined: playing() });

    await screen.findByText(/board is not available yet/);
    const page = document.querySelector("[data-cc-phase]");
    expect(page).toHaveAttribute("data-cc-phase", "my-turn");
    expect(page).toHaveAttribute("data-cc-request", "none");
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
    // The room starts listening in an effect, which can run a moment after the text shows. It listens for its
    // updates and for the connection at the same time, so once one is heard the other is too (CC-288).
    await vi.waitFor(() => expect(socket.on).toHaveBeenCalledWith("room:updated", expect.any(Function)));
    expect(socket.request).not.toHaveBeenCalledWith("room:join", expect.anything());

    act(() => socket.push("connect"));

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
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
    expect(await screen.findByRole("gridcell", { name: "top left: X" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Waiting for Bob")).toBeInTheDocument();
  });
});

// The server records the match in the background, so its progress update can come before the page has drawn the
// result. The result must still show it (CC-235).
describe("the result's own XP and reason", () => {
  const forfeitWin = { result: "win", winners: [GUEST.id], reason: "forfeit" };
  const game = ({ matchId = "match-1", outcome = { status: "ongoing" } } = {}) => ({
    matchId,
    view: {},
    activePlayers: outcome.status === "ongoing" ? [GUEST.id] : [],
    outcome,
  });
  const finishedRoom = (matchId) =>
    playing({ status: "finished", game: game({ matchId, outcome: forfeitWin }) });
  const uncounted = (matchId) => ({
    source: "match",
    key: matchId,
    matchId,
    xpGained: 0,
    leveledUp: false,
    progress: { level: 1 },
    counted: false,
    notCountedReason: "ended-too-soon",
  });
  const counted = (matchId) => ({ ...uncounted(matchId), xpGained: 30, counted: true, notCountedReason: "" });
  const resultOf = () => screen.getByRole("heading", { name: "You won by forfeit" }).parentElement;
  const xpPop = () => document.querySelector("[data-effect='xp-pop']");

  async function playingRoom() {
    const opened = openRoom({ joined: playing({ game: game() }) });
    await screen.findByText(/board is not available yet/);
    return opened;
  }

  it("says why the game didn't count when the update came before the result was drawn", async () => {
    const { socket } = await playingRoom();

    act(() => {
      socket.push("room:updated", finishedRoom("match-1"));
      socket.push("progress:updated", uncounted("match-1"));
    });

    expect(
      await within(resultOf()).findByText("This game didn't count: it ended too soon"),
    ).toBeInTheDocument();
  });

  it("floats the XP when the update came before the room said the game was over", async () => {
    const { socket } = await playingRoom();

    act(() => socket.push("progress:updated", counted("match-1")));
    act(() => socket.push("room:updated", finishedRoom("match-1")));

    expect(await screen.findByRole("heading", { name: "You won by forfeit" })).toBeInTheDocument();
    expect(xpPop()).toHaveTextContent("+30 XP");
  });

  it("never shows the update of the game before under the next game's result", async () => {
    const { socket } = await playingRoom();

    act(() => socket.push("progress:updated", uncounted("match-0")));
    act(() => socket.push("room:updated", finishedRoom("match-1")));

    await screen.findByRole("heading", { name: "You won by forfeit" });
    expect(within(resultOf()).queryByText(/didn't count/)).toBeNull();
    expect(xpPop()).toBeNull();
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

describe("RoomPage: someone arriving without a session chooses how to join (CC-086)", () => {
  const INVITE = "/games/tic-tac-toe/rooms/AB2CD3";

  /** A visitor with no session opens the invite; the socket answers room:join with the waiting room. */
  function openInvite({ path = INVITE, api = fakeApi(), history = [] } = {}) {
    const socket = fakeSocket();
    socket.request.mockResolvedValue(roomView());
    return renderApp({ path, history, api, socket });
  }

  it("asks how to join, without creating anything on the server", async () => {
    const { api, socket } = openInvite();

    const heading = await screen.findByRole("heading", { name: "You're invited to play Tic Tac Toe" });

    // The chooser moves focus in an effect, which can run a moment after the heading shows (CC-288).
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("AB2CD3")).toBeInTheDocument();
    // Arcade art (CC-087): the invite envelope above the heading, the game's glyph by the code — decoration.
    expect(heading.previousElementSibling.tagName).toBe("svg");
    expect(heading.previousElementSibling).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("AB2CD3").parentElement.querySelector("svg")).toHaveClass("tictactoe");
    expect(screen.getByRole("button", { name: "Play as guest" })).toBeEnabled();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(INVITE)}`,
    );
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      `/signup?next=${encodeURIComponent(INVITE)}`,
    );
    expect(document.title).toBe("Tic Tac Toe · Room AB2CD3 · ClassiCade");
    expect(api.startGuest).not.toHaveBeenCalled();
    expect(socket.request).not.toHaveBeenCalled();
  });

  it("joins as a guest after choosing to", async () => {
    const user = userEvent.setup();
    const { api, socket } = openInvite();

    await user.click(await screen.findByRole("button", { name: "Play as guest" }));

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(socket.request).toHaveBeenCalledWith("room:join", { code: "AB2CD3" });
  });

  it("says why when no guest session can be started, and lets you try again", async () => {
    const user = userEvent.setup();
    const startGuest = vi
      .fn()
      .mockRejectedValueOnce(
        new AppRequestError({ code: "RATE_LIMITED", message: "Too many requests, try again later" }),
      )
      .mockResolvedValue(GUEST);
    openInvite({ api: fakeApi({ startGuest }) });

    await user.click(await screen.findByRole("button", { name: "Play as guest" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests, try again later");
    expect(screen.getByRole("button", { name: "Play as guest" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Play as guest" }));
    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
  });

  it("names no game for an old link, and logging in returns to that link", async () => {
    openInvite({ path: "/room/AB2CD3" });

    expect(await screen.findByRole("heading", { name: "You're invited to play" })).toBeInTheDocument();
    expect(screen.getByText("AB2CD3").parentElement.querySelector("svg")).toBeNull();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login?next=%2Froom%2FAB2CD3",
    );
    expect(document.title).toBe("Room AB2CD3 · ClassiCade");
  });

  it("shows neither the choice nor a join while the session is still loading", async () => {
    const socket = fakeSocket();
    renderApp({ path: INVITE, socket, api: fakeApi({ getSession: () => new Promise(() => {}) }) });

    expect(await screen.findByText(/Joining room AB2CD3/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play as guest" })).toBeNull();
    expect(socket.request).not.toHaveBeenCalled();
  });

  it("explains when the session can't be loaded", async () => {
    const { api } = openInvite({
      api: fakeApi({
        getSession: async () => {
          throw new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade" });
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Can't join this room" })).toBeInTheDocument();
    expect(screen.getByText("Can't reach ClassiCade")).toBeInTheDocument();
    expect(api.startGuest).not.toHaveBeenCalled();
  });

  it("goes to log in, and Back from there shows the choice again", async () => {
    const user = userEvent.setup();
    const { url, back } = openInvite({ history: ["/"] });

    await user.click(await within(screen.getByRole("main")).findByRole("link", { name: "Log in" }));
    expect(url()).toBe(`/login?next=${encodeURIComponent(INVITE)}`);
    back();

    expect(url()).toBe(INVITE);
    expect(
      await screen.findByRole("heading", { name: "You're invited to play Tic Tac Toe" }),
    ).toBeInTheDocument();
  });

  it("someone who already has a session skips the choice", async () => {
    openRoom();

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play as guest" })).toBeNull();
  });
});
