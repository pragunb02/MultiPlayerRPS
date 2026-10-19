import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { installVisibility } from "../../testing/visibility.js";

// What a player hears and is asked in a room (CC-103, CC-104, CC-159, CC-160): sounds from room updates, the request
// banner for a draw offer or a rematch, the asker's side with Cancel, how each request ended for both players, and
// the background tab title.

const presence = (connected = true) => ({
  connected,
  presence: connected ? "here" : "offline",
  since: 0,
  graceUntil: 0,
});
const ME = { playerId: GUEST.id, displayName: GUEST.displayName, ...presence() };
const BOB = { playerId: "guest_b", displayName: "Bob", ...presence() };
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const T = 1_000_000;

/** A request in the shape the server sends. */
const request = ({ type = "rematch", from = BOB.playerId, to = GUEST.id, state = "open", ...rest } = {}) => ({
  type,
  from,
  to,
  createdAt: T,
  expiresAt: T + (type === "draw" ? 30_000 : 60_000),
  state,
  endedAt: state === "open" ? 0 : T + 5,
  ...rest,
});
const draw = (overrides) => request({ type: "draw", ...overrides });

const chess = ({ view = {}, activePlayers = [GUEST.id], requests = [], ...overrides } = {}) => ({
  code: "AB2CD3",
  gameId: "chess",
  status: "playing",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  serverTime: T,
  requests,
  requestsLeft: { draw: 3 },
  askAgainAt: {},
  game: {
    view: {
      fen: START,
      moves: [],
      lastMove: {},
      colors: { [GUEST.id]: "w", [BOB.playerId]: "b" },
      toMove: GUEST.id,
      inCheck: false,
      timeControl: "blitz-5+0",
      clocks: { w: 300_000, b: 300_000 },
      lastMoveAt: 0,
      ...view,
    },
    activePlayers,
    outcome: { status: "ongoing" },
    number: 1,
    turnEndsAt: 0,
  },
  ...overrides,
});

const WIN = { status: "finished", result: "win", winners: [GUEST.id], reason: "reached-target" };
// The rematch window ends half an hour after the game (CC-101).
const UNTIL = T + 30 * 60 * 1000;
const finished = ({ requests = [], rematch = { available: true }, ...overrides } = {}) => ({
  code: "AB2CD3",
  gameId: "ludo",
  status: "finished",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  serverTime: T,
  requests,
  requestsLeft: {},
  askAgainAt: {},
  game: { view: {}, activePlayers: [], outcome: WIN, number: 1, turnEndsAt: 0 },
  rematch: { until: UNTIL, ...rematch },
  series: { games: 1, wins: { [GUEST.id]: 1 } },
  ...overrides,
});
/** The rematch has started: the same room, playing again. */
const rematchStarted = (requests = []) => ({
  ...finished({ requests }),
  status: "playing",
  game: { view: {}, activePlayers: [GUEST.id], outcome: { status: "ongoing" }, number: 2, turnEndsAt: 0 },
  rematch: undefined,
});

/** Opens the room. The socket answers each request with `answers[event]` (a view, or a function giving one). */
function openRoom(joined, answers = {}) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event, payload) => {
    if (event === "room:join") return joined;
    const answer = answers[event];
    return typeof answer === "function" ? answer(payload) : answer;
  });
  const sound = fakeSound();
  const path = `/games/${joined.gameId === "chess" ? "chess" : "ludo"}/rooms/AB2CD3`;
  const view = renderApp({ path, socket, sound, api: fakeApi({ getSession: async () => GUEST }) });
  return { ...view, socket, sound };
}

const push = (socket, room) => act(() => socket.push("room:updated", room));
// A question asked of the viewer is a region named after the request, in the page above the board (CC-160).
const POPUP = { name: /^(Draw offer|Rematch\?)$/ };
// The chess board loads on demand, which can take a while on a busy machine.
const SLOW = Object.freeze({ timeout: 10_000 });
const board = () => screen.findByRole("grid", { name: "Chess board" }, SLOW);
const popup = () => screen.findByRole("region", POPUP, SLOW);
const noPopup = () => expect(screen.queryByRole("region", POPUP)).not.toBeInTheDocument();
const answered = (type, answer) => ["room:answer", { code: "AB2CD3", type, answer }];

// The chess board is downloaded the first time a room shows it. Under a busy test run that first download took
// longer than a query waits, so it is loaded once before the tests instead.
beforeAll(() => import("../../games/chess/ChessBoard.jsx"));
beforeEach(() => {
  installVisibility({ hidden: false });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("draw offers (CC-104, CC-159)", () => {
  it("asks you in the banner with a chime and the time left, and accepting sends the answer", async () => {
    const user = userEvent.setup();
    const { socket, sound } = openRoom(chess(), { "room:answer": () => chess() });
    await board();

    push(socket, chess({ requests: [draw()] }));

    const dialog = await popup();
    expect(dialog).toHaveAccessibleName("Draw offer");
    expect(dialog).toHaveAccessibleDescription("Bob offers a draw.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Bob offers a draw.");
    expect(within(dialog).getByRole("progressbar", { name: "Time left to answer" })).toHaveAttribute(
      "max",
      "30000",
    );
    expect(within(dialog).getByText("0:30")).toBeInTheDocument();
    expect(sound.played).toEqual(["notify"]);

    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    expect(socket.request).toHaveBeenCalledWith(...answered("draw", "accept"));
    await waitFor(noPopup);
  });

  it("declines with Decline, and the game goes on", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess({ requests: [draw()] }), {
      "room:answer": () => chess({ requests: [draw({ state: "declined" })] }),
    });

    await user.click(within(await popup()).getByRole("button", { name: "Decline" }));

    expect(socket.request).toHaveBeenCalledWith(...answered("draw", "decline"));
    await waitFor(noPopup);
    expect(await screen.findByText("You said no")).toBeInTheDocument();
    expect(await board()).toBeInTheDocument();
  });

  it("can be hidden without answering, with Hide or Escape, and the board stays usable", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess({ requests: [draw()] }));

    await user.click(within(await popup()).getByRole("button", { name: "Hide" }));
    noPopup();
    expect(await screen.findByRole("gridcell", { name: "e2, white pawn" }, SLOW)).toBeEnabled();

    // The offer ends and a new one comes: that one is shown again.
    push(socket, chess({ requests: [draw({ state: "withdrawn" })] }));
    push(socket, chess({ requests: [draw({ createdAt: T + 20_000, expiresAt: T + 50_000 })] }));
    const again = await popup();
    // Escape on the board is the board's (it puts a piece down). Inside the banner it hides the question.
    await user.click(screen.getByRole("gridcell", { name: "e2, white pawn" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", POPUP)).toBeInTheDocument();
    within(again).getByRole("button", { name: "Decline" }).focus();
    await user.keyboard("{Escape}");
    noPopup();
  });

  it("closes by itself when the offer is withdrawn, and says so", async () => {
    const { socket, sound } = openRoom(chess({ requests: [draw()] }));
    await popup();

    push(socket, chess({ requests: [draw({ state: "withdrawn" })] }));

    await waitFor(noPopup);
    expect(await screen.findByText("Bob withdrew the draw offer")).toBeInTheDocument();
    expect(sound.played).toEqual([]);
  });

  it("shows the offerer what they wait for with Cancel, and tells them about a decline", async () => {
    const user = userEvent.setup();
    const mine = draw({ from: GUEST.id, to: BOB.playerId });
    const offered = chess({ requests: [mine], activePlayers: [BOB.playerId] });
    const { socket, sound } = openRoom(offered, {
      "room:answer": () => chess({ requests: [{ ...mine, state: "withdrawn", endedAt: T + 1 }] }),
    });

    const card = await screen.findByRole("region", { name: "Draw offered" });
    expect(within(card).getByRole("status")).toHaveTextContent("Draw offered. Waiting for Bob to answer");
    expect(screen.getByRole("button", { name: "Draw offered" })).toHaveAttribute("aria-disabled", "true");

    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(socket.request).toHaveBeenCalledWith(...answered("draw", "withdraw"));
    expect(await screen.findByText("You took the request back")).toBeInTheDocument();

    push(socket, offered);
    push(socket, chess({ requests: [{ ...mine, state: "declined", endedAt: T + 2 }] }));
    expect(await screen.findByText("Bob declined your draw offer")).toBeInTheDocument();
    expect(sound.played).toEqual(["notify"]);
  });

  it("offers a draw through the room, and says why Offer draw waits after a no and once they are used up", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess(), { "room:request": () => chess() });

    await user.click(await screen.findByRole("button", { name: "Offer draw" }));
    expect(socket.request).toHaveBeenCalledWith("room:request", { code: "AB2CD3", type: "draw" });

    push(socket, chess({ askAgainAt: { draw: T + 10_000 } }));
    expect(screen.getByRole("button", { name: "Offer draw" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Offer draw" })).toHaveAccessibleDescription(
      "You can ask again in a moment",
    );
    push(socket, chess({ requestsLeft: { draw: 0 } }));
    expect(screen.getByRole("button", { name: "Offer draw" })).toHaveAccessibleDescription(
      "You have used every offer this game allows",
    );
    push(socket, chess({ requests: [draw()] }));
    expect(screen.getByRole("button", { name: "Offer draw" })).toHaveAccessibleDescription(
      "Bob asked first. Answer it above the board",
    );
  });

  it("explains an answer the server refused", async () => {
    const user = userEvent.setup();
    openRoom(chess({ requests: [draw()] }), {
      "room:answer": () => {
        throw new AppRequestError({ code: "CONFLICT", message: "That request is no longer open" });
      },
    });

    await user.click(within(await popup()).getByRole("button", { name: "Accept" }));

    expect(await screen.findByText("That request is no longer open")).toBeInTheDocument();
    expect(within(screen.getByRole("region", POPUP)).getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("never takes focus: a player in the middle of a move keeps the board (CC-104)", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess(), {
      "game:move": () => chess({ view: { fen: AFTER_E4, moves: ["e4"] }, requests: [draw()] }),
    });
    const e2 = await screen.findByRole("gridcell", { name: "e2, white pawn" }, SLOW);
    await user.click(e2);

    push(socket, chess({ requests: [draw()] }));
    await popup();

    expect(e2).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(socket.request).toHaveBeenCalledWith("game:move", {
      code: "AB2CD3",
      move: { type: "move", from: "e2", to: "e4" },
    });
  });

  it("leaves focus where the player put it while the question was open", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(chess());
    await board();
    push(socket, chess({ requests: [draw()] }));
    await popup();

    await user.click(screen.getByRole("gridcell", { name: "e2, white pawn" }));
    push(socket, chess({ requests: [draw({ state: "withdrawn" })] }));

    await waitFor(noPopup);
    expect(screen.getByRole("gridcell", { name: /^e2/ })).toHaveFocus();
  });

  it("asks spectators nothing", async () => {
    openRoom(chess({ you: "", requests: [draw()] }));

    await board();
    noPopup();
    expect(screen.queryByRole("region", { name: "Draw offered" })).not.toBeInTheDocument();
  });
});

describe("rematch requests (CC-104, CC-159)", () => {
  it("asks you in the banner, and Accept accepts it", async () => {
    const user = userEvent.setup();
    const { socket, sound } = openRoom(finished(), { "room:answer": () => rematchStarted() });
    await screen.findByRole("heading", { name: "You won!" });

    push(socket, finished({ requests: [request()] }));
    const dialog = await popup();
    expect(dialog).toHaveAccessibleName("Rematch?");
    expect(dialog).toHaveAccessibleDescription("Bob wants a rematch.");
    expect(sound.played).toEqual(["notify"]);

    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    expect(socket.request).toHaveBeenCalledWith(...answered("rematch", "accept"));
  });

  it("declines with Decline", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom(finished({ requests: [request()] }), {
      "room:answer": () => finished({ requests: [request({ state: "declined" })] }),
    });

    await user.click(within(await popup()).getByRole("button", { name: "Decline" }));

    expect(socket.request).toHaveBeenCalledWith(...answered("rematch", "decline"));
    await waitFor(noPopup);
    expect(screen.getByText("You declined the rematch. Changed your mind?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rematch" })).toBeInTheDocument();
  });

  it("tells the asker who declined, and they can ask again after a moment", async () => {
    vi.useFakeTimers({ now: 0, shouldAdvanceTime: true });
    const mine = request({ from: GUEST.id, to: BOB.playerId });
    const { socket, sound } = openRoom(finished({ requests: [mine] }));
    await screen.findByText("Waiting for Bob…");

    push(
      socket,
      finished({
        requests: [{ ...mine, state: "declined", endedAt: T }],
        askAgainAt: { rematch: T + 10_000 },
      }),
    );

    expect(await screen.findByText("Bob declined the rematch")).toBeInTheDocument();
    expect(screen.getByText("Bob declined the rematch.")).toBeInTheDocument();
    const again = screen.getByRole("button", { name: "Rematch" });
    expect(again).toHaveAccessibleDescription("You can ask again in a moment");
    expect(sound.played).toEqual(["notify"]);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("button", { name: "Rematch" })).not.toHaveAttribute("aria-disabled");
  });

  it("shows each answer for four seconds, and takes it away once it is old news", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mine = request({ from: GUEST.id, to: BOB.playerId });
    const { socket } = openRoom(finished({ requests: [mine] }));
    await screen.findByText("Waiting for Bob…");
    push(socket, finished({ requests: [{ ...mine, state: "accepted" }] }));
    expect(await screen.findByText("Bob accepted. Starting the next game")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(4_000));

    expect(screen.queryByText("Bob accepted. Starting the next game")).not.toBeInTheDocument();
  });

  it("tells the one asked when the request is taken back, and closes the question", async () => {
    const { socket } = openRoom(finished({ requests: [request()] }));
    await popup();

    push(socket, finished({ requests: [request({ state: "withdrawn" })] }));

    await waitFor(noPopup);
    expect(await screen.findByText("Bob took back the rematch request")).toBeInTheDocument();
  });

  it("closes the question when the asker leaves", async () => {
    const { socket } = openRoom(finished({ requests: [request()] }));
    await popup();

    push(socket, finished({ rematch: { available: false, leftName: "Bob" } }));

    await waitFor(noPopup);
    expect(screen.getByText("Bob left, so there is no rematch this time.")).toBeInTheDocument();
  });

  it("tells the player still there, with a chime, the moment the opponent leaves the finished game (CC-162)", async () => {
    const { socket, sound } = openRoom(
      finished({ requests: [request({ from: GUEST.id, to: BOB.playerId })] }),
    );
    await screen.findByRole("button", { name: "Cancel rematch" });

    push(socket, finished({ rematch: { available: false, leftName: "Bob" } }));

    expect(await screen.findByText("Bob left the room")).toBeInTheDocument();
    expect(sound.played).toEqual(["notify"]);
    expect(screen.queryByRole("button", { name: "Cancel rematch" })).not.toBeInTheDocument();
  });

  it("shows a reloaded page the same question, without a chime", async () => {
    const { sound } = openRoom(finished({ requests: [request()] }));

    expect(await popup()).toHaveAccessibleDescription("Bob wants a rematch.");
    expect(sound.played).toEqual([]);
  });

  it("holds rewards back while a question is open (CC-208)", async () => {
    const { socket } = openRoom(finished({ requests: [request()] }));
    await popup();
    // The page settles once the session is known, so the reward below arrives while the question already holds.
    await waitFor(() =>
      expect(within(screen.getAllByRole("banner")[0]).getByText(GUEST.displayName)).toBeVisible(),
    );

    act(() =>
      socket.push("progress:updated", {
        source: "match",
        key: "m1",
        matchId: "m1",
        xpGained: 30,
        leveledUp: false,
        progress: { level: 1, xp: 30 },
        counted: true,
        notCountedReason: "",
      }),
    );
    const toasts = () => document.querySelector("[aria-live='polite'][role='status']");
    expect(toasts()).not.toHaveTextContent("+30 XP");
    push(socket, finished({ requests: [request({ state: "withdrawn" })] }));

    await waitFor(() => expect(toasts()).toHaveTextContent("+30 XP"));
  });
});

describe("requests the opponent cannot answer (CC-207)", () => {
  const mine = request({ from: GUEST.id, to: BOB.playerId });
  const away = { ...BOB, connected: false, presence: "away" };
  const offline = { ...BOB, connected: false, presence: "offline" };

  it("tells the asker the opponent is on another page and has been told", async () => {
    openRoom(finished({ requests: [mine], seats: [ME, away] }));

    expect(await screen.findByText(/Bob is on another page\. They have been told\./)).toBeInTheDocument();
  });

  it("tells the asker at once that the opponent is offline, with ways to play on", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const view = openRoom(finished({ requests: [mine], seats: [ME, offline] }), {
      "room:leave": { left: true },
    });

    expect(
      await screen.findByText(/Bob is offline right now, so they cannot answer yet\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/games/ludo/rooms/AB2CD3`);
    expect(await screen.findByText("Link copied. Send it to bring them back")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play vs computer" })).toHaveAttribute("href", "/games/ludo");

    await user.click(screen.getAllByRole("button", { name: "New opponent" })[0]);
    expect(view.socket.request).toHaveBeenCalledWith("room:leave", { code: "AB2CD3" });
    await waitFor(() => expect(view.url()).toBe("/games/ludo"));
    vi.unstubAllGlobals();
  });

  it("says when the link cannot be copied", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    openRoom(finished({ requests: [mine], seats: [ME, offline] }));

    await user.click(await screen.findByRole("button", { name: "Copy invite link" }));

    expect(
      await screen.findByText("Couldn't copy. Copy the address from the address bar"),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("keeps a rematch nobody answered on screen with the same choices until it is put away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { socket } = openRoom(finished({ requests: [mine] }));
    await screen.findByText("Waiting for Bob…");

    push(socket, finished({ requests: [{ ...mine, state: "expired" }] }));
    expect(await screen.findByText("No answer from Bob")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("No answer from Bob")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();

    await act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(screen.queryByText("No answer from Bob")).not.toBeInTheDocument();
  });
});

describe("an opponent who lost their connection during the game (CC-036)", () => {
  it("lets the player claim the win once the grace period is over", async () => {
    vi.useFakeTimers({ now: 0, shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const gone = { ...BOB, connected: false, presence: "offline", graceUntil: T + 2_000 };
    // The claimed win is a finished chess game, with the chess board's own view (CC-288).
    const playingRoom = chess({ seats: [ME, gone] });
    const won = {
      ...playingRoom,
      status: "finished",
      game: { ...playingRoom.game, activePlayers: [], outcome: WIN },
    };
    const { socket } = openRoom(playingRoom, { "room:claim-win": () => won });
    await board();
    expect(screen.queryByRole("button", { name: "Claim the win" })).not.toBeInTheDocument();

    // On a busy machine the countdowns can start again after the board shows (the full suite with coverage once
    // still read 0:02 after three seconds), so the time moves on in steps until the grace period is over on screen.
    await vi.waitFor(() => {
      act(() => vi.advanceTimersByTime(1_000));
      expect(
        screen.getByText("Bob has not come back. You can claim the win, or keep waiting."),
      ).toBeInTheDocument();
    }, SLOW);
    await user.click(screen.getByRole("button", { name: "Claim the win" }));

    expect(socket.request).toHaveBeenCalledWith("room:claim-win", { code: "AB2CD3" });
  });
});

describe("room sounds (CC-103)", () => {
  it("plays nothing on joining and then the sound of each move", async () => {
    const { socket, sound } = openRoom(chess());
    await board();
    expect(sound.played).toEqual([]);

    push(
      socket,
      chess({
        view: { fen: AFTER_E4, moves: ["e4"], toMove: BOB.playerId, lastMoveAt: 1_000_000 },
        activePlayers: [BOB.playerId],
      }),
    );

    expect(sound.played).toEqual(["move"]);
  });

  it("plays the start when the opponent joins and the game begins", async () => {
    const waiting = { ...chess(), status: "waiting", seats: [ME], game: undefined };
    const { socket, sound } = openRoom(waiting);
    await screen.findByRole("heading", { name: "Invite a friend" });

    push(socket, chess());

    expect(sound.played).toEqual(["game-start"]);
  });
});

describe("background tab (CC-104)", () => {
  it("calls you back with the tab title and a sound when it becomes your move", async () => {
    const tab = installVisibility({ hidden: false });
    const theirMove = chess({ view: { toMove: BOB.playerId }, activePlayers: [BOB.playerId] });
    const { socket, sound } = openRoom(theirMove);
    await board();
    act(() => tab.setHidden(true));
    expect(document.title).toBe("Chess · Room AB2CD3 · ClassiCade");

    push(socket, chess({ view: { fen: AFTER_E4, moves: ["e4"] } }));

    expect(document.title).toBe("Your turn! · ClassiCade");
    expect(sound.played).toEqual(["move", "your-turn"]);

    act(() => tab.setHidden(false));
    expect(document.title).toBe("Chess · Room AB2CD3 · ClassiCade");
  });
});

describe("sound control in the header (CC-103, CC-208)", () => {
  it("mutes and unmutes, named for what you hear", async () => {
    const user = userEvent.setup();
    const sound = fakeSound();
    renderApp({ sound });

    await user.click(screen.getByRole("button", { name: "Sound on" }));
    expect(sound.setMuted).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("slider", { name: "Volume" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Sound off" }));
    expect(sound.setMuted).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Sound on" })).toBeInTheDocument();
  });

  it("sets the volume and plays a sample at the new level", () => {
    const sound = fakeSound();
    renderApp({ sound });

    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveValue("60");
    fireEvent.change(slider, { target: { value: "25" } });

    expect(sound.setVolume).toHaveBeenCalledWith(0.25);
    expect(sound.played).toEqual(["move"]);
  });

  it("shows sound off at zero volume, and turning it on raises the volume to the default", async () => {
    const user = userEvent.setup();
    const sound = fakeSound({ volume: 0 });
    renderApp({ sound });

    await user.click(screen.getByRole("button", { name: "Sound off" }));

    expect(sound.setVolume).toHaveBeenCalledWith(0.6);
    expect(screen.getByRole("button", { name: "Sound on" })).toBeInTheDocument();
  });

  it("starts muted when the player muted it before", () => {
    renderApp({ sound: fakeSound({ muted: true }) });

    expect(screen.getByRole("button", { name: "Sound off" })).toBeInTheDocument();
  });

  it("marks the app's buttons for the click sound", async () => {
    renderApp({ sound: fakeSound() });

    expect(await screen.findByRole("button", { name: "Play as a guest" })).toHaveAttribute(
      "data-sound",
      "click",
    );
  });

  it("opens the sound settings: each kind of notice can be switched off or made quieter", async () => {
    const user = userEvent.setup();
    const sound = fakeSound();
    renderApp({ sound });

    await user.click(screen.getByRole("button", { name: "Sound settings" }));
    const dialog = screen.getByRole("dialog", { name: "Sound settings" });
    expect(within(dialog).getAllByRole("checkbox", { name: "Sound on" })).toHaveLength(6);
    await user.click(within(dialog).getAllByRole("checkbox", { name: "Sound on" })[3]);
    expect(sound.setCategory).toHaveBeenLastCalledWith("reward", { on: false });
    expect(
      within(dialog).getByRole("slider", { name: "Rewards (XP, levels, achievements) volume" }),
    ).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("slider", { name: "Requests (rematch, draw offer) volume" }), {
      target: { value: "40" },
    });
    expect(sound.setCategory).toHaveBeenLastCalledWith("request", { volume: 0.4 });
    expect(sound.played).toEqual(["notify"]);

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says in the settings that all sound is off while muted", async () => {
    const user = userEvent.setup();
    renderApp({ sound: fakeSound({ muted: true }) });

    await user.click(screen.getByRole("button", { name: "Sound settings" }));

    expect(screen.getByText("All sound is off. Turn it on with the speaker button.")).toBeInTheDocument();
  });
});
