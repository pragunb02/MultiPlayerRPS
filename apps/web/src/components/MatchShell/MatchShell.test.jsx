import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { chessActions } from "../../games/chess/chessActions.js";
import { SessionProvider } from "../../hooks/SessionProvider.jsx";
import { fakeApi, fakeSessionBroadcast, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { MatchProgressProvider } from "../Celebrations/MatchProgressProvider.jsx";
import { SaveProgressProvider } from "../SaveProgress/SaveProgressProvider.jsx";
import { ToastProvider } from "../Toast/ToastProvider.jsx";
import { useToast } from "../Toast/toastContext.js";
import { useAnnounce } from "./announceContext.js";
import { MatchShell } from "./MatchShell.jsx";

const T = 7_000_000;
const ME = {
  playerId: GUEST.id,
  displayName: GUEST.displayName,
  connected: true,
  presence: "here",
  graceUntil: 0,
};
const BOB = { playerId: "guest_b", displayName: "Bob", connected: true, presence: "here", graceUntil: 0 };
const WIN = { status: "finished", result: "win", winners: [GUEST.id], reason: "resignation" };

/** A RoomView of a chess room from the guest's seat, the guest to move. */
const roomView = (overrides = {}) => ({
  code: "AB2CD3",
  gameId: "chess",
  status: "playing",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  requests: [],
  requestsLeft: {},
  askAgainAt: {},
  serverTime: T,
  game: { view: {}, activePlayers: [GUEST.id], outcome: { status: "ongoing" }, number: 1, turnEndsAt: 0 },
  ...overrides,
});
const theirTurn = (overrides) =>
  roomView({
    game: {
      view: {},
      activePlayers: [BOB.playerId],
      outcome: { status: "ongoing" },
      number: 1,
      turnEndsAt: 0,
    },
    ...overrides,
  });
const finished = (overrides) =>
  roomView({
    status: "finished",
    rematch: { available: true, until: T + 60_000 },
    game: { view: {}, activePlayers: [], outcome: WIN, number: 1, turnEndsAt: 0, matchId: "m1" },
    ...overrides,
  });
const drawOffer = (from, to) => ({
  type: "draw",
  from,
  to,
  createdAt: T,
  expiresAt: T + 30_000,
  state: "open",
  endedAt: 0,
});

/** A game's board as the fakes write it: one button that plays, and the reason it cannot. */
function FakeBoard({ room, onMove, reason }) {
  return (
    <div>
      <button type="button" data-cc-control="fake.play" onClick={() => onMove({ type: "play" })}>
        Play here
      </button>
      <p>Board for game {room.game.number}</p>
      <p data-testid="board-reason">{reason}</p>
    </div>
  );
}
const BOARD_ONLY = Object.freeze({ Board: FakeBoard });

/** What the toasts can do, caught from inside the providers so a test can show one as a reward would. */
const caughtToasts = {};
function GrabToasts() {
  Object.assign(caughtToasts, useToast());
  return null;
}
const toastsOf = () => caughtToasts;
const toastRegion = () => document.querySelector("[role='status'][aria-live='polite']");

/** Renders the shell inside the app's providers, with every call it can make as a spy. */
function mount(room, { game = BOARD_ONLY, reconnecting = false, waiting = <p>Invite here</p> } = {}) {
  const calls = {
    onMove: vi.fn(async () => ({})),
    onAsk: vi.fn(async () => ({})),
    onAnswer: vi.fn(async () => ({})),
    onClaimWin: vi.fn(async () => ({})),
    onWindowEnded: vi.fn(),
    onLeave: vi.fn(async () => ({})),
  };
  const services = {
    api: fakeApi({ getSession: async () => GUEST }),
    socket: fakeSocket(),
    sound: fakeSound(),
    sessionBroadcast: fakeSessionBroadcast(),
  };
  const ui = (view, options = {}) => (
    <MemoryRouter>
      <ServicesProvider services={services}>
        <SessionProvider>
          <ToastProvider>
            <GrabToasts />
            <SaveProgressProvider>
              <MatchProgressProvider>
                <MatchShell
                  room={view}
                  game={options.game ?? game}
                  reconnecting={options.reconnecting ?? reconnecting}
                  waiting={waiting}
                  {...calls}
                />
              </MatchProgressProvider>
            </SaveProgressProvider>
          </ToastProvider>
        </SessionProvider>
      </ServicesProvider>
    </MemoryRouter>
  );
  const result = render(ui(room));
  return { ...result, calls, update: (view, options) => result.rerender(ui(view, options)) };
}

const slot = (name) => document.querySelector(`[data-cc-slot="${name}"]`);
const controlsIn = (element) =>
  [...element.querySelectorAll("[data-cc-control]")].map((control) => control.dataset.ccControl);

describe("MatchShell with a game that brings only a Board (CC-157)", () => {
  it("shows the board on the stage, the game's name in the match bar and Leave in the action bar", () => {
    mount(roomView());

    expect(within(slot("stage")).getByText("Board for game 1")).toBeInTheDocument();
    expect(within(slot("match-bar")).getByRole("heading", { level: 1 })).toHaveTextContent("Chess");
    expect(controlsIn(slot("action-bar"))).toEqual(["room.leave"]);
    expect(within(slot("presence")).getByRole("list", { name: "Players" })).toHaveTextContent("Bob");
    expect(slot("panel")).toBeNull();
  });

  it("plays: the board's move goes to the room", async () => {
    const user = userEvent.setup();
    const { calls } = mount(roomView());

    await user.click(screen.getByRole("button", { name: "Play here" }));

    expect(calls.onMove).toHaveBeenCalledWith({ type: "play" });
  });

  it("tells the board why the viewer cannot play: their turn, or reconnecting", () => {
    const { update } = mount(theirTurn());
    expect(screen.getByTestId("board-reason")).toHaveTextContent("Not your turn");

    update(roomView(), { reconnecting: true });
    expect(screen.getByTestId("board-reason")).toHaveTextContent("Reconnecting. Your move can wait.");
  });

  it("writes the match phase and the request state on the frame, for tests and telemetry", () => {
    const { container, update } = mount(roomView());
    const frame = () => container.querySelector("[data-cc-phase]");
    expect(frame()).toHaveAttribute("data-cc-phase", "my-turn");
    expect(frame()).toHaveAttribute("data-cc-request", "none");

    update(roomView({ requests: [drawOffer(BOB.playerId, GUEST.id)] }));
    expect(frame()).toHaveAttribute("data-cc-request", "incoming");

    update(roomView({ requests: [drawOffer(GUEST.id, BOB.playerId)] }));
    expect(frame()).toHaveAttribute("data-cc-request", "outgoing");
  });

  it("shows the invite on the stage while the room waits, and no board", () => {
    mount(roomView({ status: "waiting", seats: [ME], game: undefined }));

    expect(within(slot("stage")).getByText("Invite here")).toBeInTheDocument();
    expect(screen.queryByText(/Board for game/)).toBeNull();
    expect(controlsIn(slot("action-bar"))).toEqual(["room.leave"]);
  });

  it("says so when the game has no board in the web app yet", () => {
    mount(roomView({ gameId: "ludo" }), { game: {} });

    expect(within(slot("stage")).getByText("The game board is not available yet.")).toBeInTheDocument();
    expect(within(slot("match-bar")).getByRole("heading", { level: 1 })).toHaveTextContent("ludo");
  });

  it("starts a fresh board for a rematch", () => {
    const { update } = mount(roomView());
    const first = screen.getByRole("button", { name: "Play here" });

    update(roomView({ game: { ...roomView().game, number: 2 } }));

    expect(screen.getByText("Board for game 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play here" })).not.toBe(first);
  });

  it("never moves the focus away from the board when a request comes in", () => {
    const { update } = mount(roomView());
    const board = screen.getByRole("button", { name: "Play here" });
    act(() => board.focus());

    update(roomView({ requests: [drawOffer(BOB.playerId, GUEST.id)] }));

    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(board).toHaveFocus();
  });
});

describe("MatchShell action bar", () => {
  it("puts the game's actions before Leave, for a seated player while the game is on", () => {
    mount(roomView(), { game: { Board: FakeBoard, actions: chessActions } });

    expect(controlsIn(slot("action-bar"))).toEqual(["chess.offer_draw", "chess.resign", "room.leave"]);
  });

  it("gives a spectator no game actions", () => {
    mount(roomView({ you: "" }), { game: { Board: FakeBoard, actions: chessActions } });

    expect(controlsIn(slot("action-bar"))).toEqual(["room.leave"]);
  });

  it("shows the game's own reason on its action", () => {
    const action = {
      control: "fake.wait",
      label: "Wait",
      reason: "Not yet",
      intent: { type: "move", move: {} },
    };
    mount(roomView(), { game: { Board: FakeBoard, actions: () => [action] } });

    expect(screen.getByRole("button", { name: "Wait" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Wait" })).toHaveAccessibleDescription("Not yet");
  });

  it("closes every action while reconnecting, and says why", () => {
    mount(roomView(), { game: { Board: FakeBoard, actions: chessActions }, reconnecting: true });

    for (const name of ["Offer draw", "Resign", "Leave room"]) {
      expect(screen.getByRole("button", { name })).toHaveAccessibleDescription(
        "Reconnecting. Your move can wait.",
      );
    }
  });

  it("says the clock may still run while reconnecting in a game with a turn limit (CC-350)", () => {
    const timed = roomView();
    mount(
      { ...timed, game: { ...timed.game, turnEndsAt: T + 60_000 } },
      { game: { Board: FakeBoard, actions: chessActions }, reconnecting: true },
    );

    expect(screen.getByRole("button", { name: "Resign" })).toHaveAccessibleDescription(
      "Reconnecting… Your clock may still be running.",
    );
    expect(screen.getByTestId("board-reason")).toHaveTextContent(
      "Reconnecting… Your clock may still be running.",
    );
  });

  it("asks first for an action that needs it, in the shell's dialog, and sends it on confirm", async () => {
    const user = userEvent.setup();
    const { calls } = mount(roomView(), { game: { Board: FakeBoard, actions: chessActions } });

    await user.click(screen.getByRole("button", { name: "Resign" }));
    const dialog = screen.getByRole("dialog", { name: "Resign this game?" });
    expect(dialog).toHaveTextContent("Your opponent will win the game.");
    expect(within(dialog).getByRole("button", { name: "Keep playing" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Resign" }));

    expect(calls.onMove).toHaveBeenCalledWith({ type: "resign" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["Keep playing", (user) => user.click(screen.getByRole("button", { name: "Keep playing" }))],
    ["Escape", (user) => user.keyboard("{Escape}")],
  ])("lets the player call it off (%s)", async (_how, callOff) => {
    const user = userEvent.setup();
    const { calls } = mount(roomView(), { game: { Board: FakeBoard, actions: chessActions } });

    await user.click(screen.getByRole("button", { name: "Resign" }));
    await callOff(user);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.onMove).not.toHaveBeenCalled();
  });

  it("sends a request action through the room, on the opponent's turn as well", async () => {
    const user = userEvent.setup();
    const { calls } = mount(theirTurn(), { game: { Board: FakeBoard, actions: chessActions } });

    await user.click(screen.getByRole("button", { name: "Offer draw" }));

    expect(calls.onAsk).toHaveBeenCalledWith("draw");
    expect(screen.getByRole("button", { name: "Resign" })).not.toHaveAttribute("aria-disabled");
  });

  it("closes a request action while a request of its kind is open, and says why", () => {
    const { update } = mount(roomView({ requests: [drawOffer(BOB.playerId, GUEST.id)] }), {
      game: { Board: FakeBoard, actions: chessActions },
    });
    expect(screen.getByRole("button", { name: "Offer draw" })).toHaveAccessibleDescription(
      "Bob asked first. Answer it above the board",
    );

    update(roomView({ requests: [drawOffer(GUEST.id, BOB.playerId)] }));
    expect(screen.getByRole("button", { name: "Draw offered" })).toHaveAccessibleDescription(
      "Waiting for Bob to answer",
    );
  });

  it("asks before leaving a game that is on, because leaving forfeits", async () => {
    const user = userEvent.setup();
    const { calls } = mount(roomView());

    await user.click(screen.getByRole("button", { name: "Leave room" }));
    const dialog = screen.getByRole("dialog", { name: "Leave the game?" });
    expect(within(dialog).getByRole("button", { name: "Stay" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Stay" }));
    expect(calls.onLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Leave room" }));
    await user.click(screen.getByRole("button", { name: "Leave and forfeit" }));
    expect(calls.onLeave).toHaveBeenCalledOnce();
  });

  it("leaves at once while the room waits", async () => {
    const user = userEvent.setup();
    const { calls } = mount(roomView({ status: "waiting", seats: [ME], game: undefined }));

    await user.click(screen.getByRole("button", { name: "Leave room" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.onLeave).toHaveBeenCalledOnce();
  });
});

describe("MatchShell at the end", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the result card with the action bar in it: Rematch first, then New opponent and Leave", () => {
    mount(finished(), { game: { Board: FakeBoard, actions: chessActions } });

    const result = slot("result");
    expect(within(result).getByRole("heading", { name: "You won by resignation" })).toBeInTheDocument();
    expect(result).toContainElement(slot("action-bar"));
    expect(controlsIn(slot("action-bar"))).toEqual(["room.rematch.ask", "room.new_opponent", "room.leave"]);
    // The board stays under the result.
    expect(within(slot("stage")).getByText("Board for game 1")).toBeInTheDocument();
  });

  it("reads the result out urgently, and takes no focus", () => {
    const { update } = mount(roomView());
    const board = screen.getByRole("button", { name: "Play here" });
    act(() => board.focus());
    const urgent = () => slot("announcer").querySelector("[aria-live='assertive']");
    expect(urgent()).toBeEmptyDOMElement();

    update(finished());

    expect(urgent()).toHaveTextContent(/^You won by resignation\. .+ Bob resigned\.$/);
    expect(board).toHaveFocus();
  });

  it("puts the outcome's line under the headline, the Hinglish line first and the English one under it (CC-163)", () => {
    mount(finished());

    const line = slot("result").querySelector("h2 + [data-cc-outcome-line]");
    expect([...line.children].map((each) => each.textContent)).toEqual([
      "Bob ne haar maan li.",
      "Bob resigned.",
    ]);
  });

  it.each([
    ["a win played to the end", WIN, "win"],
    ["a win by forfeit", { ...WIN, reason: "forfeit" }, "quiet-win"],
    ["a loss", { ...WIN, winners: [BOB.playerId] }, "gentle-loss"],
    ["a draw", { status: "finished", result: "draw", winners: [], reason: "agreement" }, "even"],
  ])("gives the result card the tone of %s", (_case, outcome, tone) => {
    mount(
      finished({ game: { view: {}, activePlayers: [], outcome, number: 1, turnEndsAt: 0, matchId: "m1" } }),
    );

    expect(slot("result")).toHaveAttribute("data-cc-tone", tone);
  });

  it("dims only the board after a loss, never the save progress card or the buttons", () => {
    const loss = { ...WIN, winners: [BOB.playerId] };
    mount(
      finished({
        game: { view: {}, activePlayers: [], outcome: loss, number: 1, turnEndsAt: 0, matchId: "m1" },
      }),
    );

    const dimmed = slot("stage").querySelectorAll("[data-cc-effect='dim']");
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0]).toHaveTextContent("Board for game 1");
    expect(dimmed[0]).toHaveClass("dimmed");
    expect(slot("result").querySelector("[data-cc-effect='dim']")).toBeNull();
  });

  it.each([
    ["a win", WIN],
    ["a draw", { status: "finished", result: "draw", winners: [], reason: "agreement" }],
  ])("leaves the board as it is after %s", (_case, outcome) => {
    mount(
      finished({ game: { view: {}, activePlayers: [], outcome, number: 1, turnEndsAt: 0, matchId: "m1" } }),
    );

    expect(document.querySelector("[data-cc-effect='dim']")).toBeNull();
  });

  it("lets rewards wait for the moment when the viewer saw the game end, one beat at a time", () => {
    vi.useFakeTimers();
    const { update } = mount(roomView());
    update(finished());

    act(() => toastsOf().show("+30 XP", { category: "reward" }));
    expect(toastRegion()).toHaveTextContent("");

    act(() => vi.advanceTimersByTime(1_200));
    expect(toastRegion()).toHaveTextContent("+30 XP");
  });

  it("does not hold rewards for a game that was over before the page opened", () => {
    mount(finished());

    act(() => toastsOf().show("+30 XP", { category: "reward" }));

    expect(toastRegion()).toHaveTextContent("+30 XP");
  });

  it("holds again for the next game of the room when it ends", () => {
    vi.useFakeTimers();
    const { update } = mount(finished());
    update(roomView({ game: { ...roomView().game, number: 2 } }));
    update(
      finished({
        game: { view: {}, activePlayers: [], outcome: WIN, number: 2, turnEndsAt: 0, matchId: "m2" },
      }),
    );

    act(() => toastsOf().show("+30 XP", { category: "reward" }));

    expect(toastRegion()).toHaveTextContent("");
  });

  it("does not dim a board that is still being played", () => {
    mount(roomView());

    expect(document.querySelector("[data-cc-effect='dim']")).toBeNull();
  });

  it("finds a new opponent and leaves without asking", async () => {
    const user = userEvent.setup();
    const { calls } = mount(finished());

    await user.click(screen.getByRole("button", { name: "New opponent" }));
    await user.click(screen.getByRole("button", { name: "Leave room" }));

    expect(calls.onLeave).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks the room for a rematch", async () => {
    const user = userEvent.setup();
    const { calls } = mount(finished());

    await user.click(screen.getByRole("button", { name: "Rematch" }));

    expect(calls.onAsk).toHaveBeenCalledWith("rematch");
  });

  it("offers a spectator the game's lobby instead", () => {
    mount(finished({ you: "" }));

    expect(screen.getByRole("link", { name: "Play Chess" })).toHaveAttribute("href", "/games/chess");
    expect(controlsIn(slot("action-bar"))).toEqual(["room.play_game", "room.leave"]);
  });

  it("names the game's lobby generically for a game the catalog does not know", () => {
    mount(finished({ you: "", gameId: "ludo" }), { game: {} });

    expect(screen.getByRole("link", { name: "Play a game" })).toHaveAttribute("href", "/games/ludo");
  });
});

describe("MatchShell requests", () => {
  it("answers a request in the banner through the room", async () => {
    const user = userEvent.setup();
    const { calls } = mount(roomView({ requests: [drawOffer(BOB.playerId, GUEST.id)] }));

    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(calls.onAnswer).toHaveBeenCalledWith("draw", "accept");
  });
});

describe("MatchShell slots a game can fill", () => {
  const Panel = ({ room }) => <p>Panel for {room.code}</p>;
  const inGameScore = (room) => ({ text: `Score in ${room.code}` });

  it("shows the game's panel in the side column and its score in the match bar", () => {
    mount(roomView(), { game: { Board: FakeBoard, Panel, inGameScore } });

    expect(within(slot("panel")).getByText("Panel for AB2CD3")).toBeInTheDocument();
    expect(within(slot("match-bar")).getByText("Score in AB2CD3")).toBeInTheDocument();
  });

  it("shows neither while the room waits", () => {
    mount(roomView({ status: "waiting", seats: [ME], game: undefined }), {
      game: { Board: FakeBoard, Panel, inGameScore },
    });

    expect(slot("panel")).toBeNull();
    expect(screen.queryByText(/Score in/)).toBeNull();
  });

  it("shows no score while the game has none", () => {
    mount(roomView(), { game: { Board: FakeBoard, inGameScore: () => undefined } });

    expect(slot("match-bar").querySelector("p")).toBeNull();
  });
});

describe("MatchShell announcer", () => {
  /** A board that reads a message out politely when its button is pressed. */
  function TalkingBoard() {
    const announce = useAnnounce();
    return (
      <button type="button" onClick={() => announce("Bob played e5")}>
        Talk
      </button>
    );
  }

  it("reads a part's message out politely, again when it repeats", async () => {
    const user = userEvent.setup();
    mount(roomView(), { game: { Board: TalkingBoard } });
    const polite = () => slot("announcer").querySelector("[aria-live='polite']");
    expect(polite()).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "Talk" }));
    const first = polite().firstElementChild;
    await user.click(screen.getByRole("button", { name: "Talk" }));

    expect(polite()).toHaveTextContent("Bob played e5");
    expect(polite().firstElementChild).not.toBe(first);
  });

  it("is only for parts of the match", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<TalkingBoard />)).toThrow(/only for parts of the match/);
    quiet.mockRestore();
  });
});
