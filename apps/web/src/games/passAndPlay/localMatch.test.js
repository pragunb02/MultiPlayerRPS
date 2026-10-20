import { describe, expect, it } from "vitest";
import { chessEngine } from "@classicade/games/chess";
import { rpsEngine } from "@classicade/games/rps";
import { tictactoeEngine } from "@classicade/games/tictactoe";
import { CHESS_REQUEST_TYPES } from "@classicade/shared";
import { checkNames, createLocalMatch, LOCAL_PLAYERS, MAX_NAME_LENGTH } from "./localMatch.js";

const [P1, P2] = LOCAL_PLAYERS;
const START = 1_000_000;

/** A clock the test moves by hand. */
function fakeClock(start = START) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

/** An RNG that always gives the same number, so the first player and the colours are known. */
const fixedRng = (value) => () => value;

const NAMES = Object.freeze(["Asha", "Ben"]);

function controllerFor(engine, { clock = fakeClock(), rng = fixedRng(0) } = {}) {
  return { match: createLocalMatch({ engine, clock, rng }), clock };
}

/** Plays a move for whoever holds the phone and returns the next session, failing the test on a refusal. */
function play(match, session, move) {
  const result = match.move(session, move);
  if (!result.ok) throw new Error(`refused: ${result.error.message}`);
  return result.session;
}

describe("checkNames", () => {
  it("keeps two typed names, trimmed", () => {
    expect(checkNames(["  Asha ", "Ben"])).toEqual({ ok: true, names: ["Asha", "Ben"] });
  });

  it("gives an empty name the player's number", () => {
    expect(checkNames(["", "  "])).toEqual({ ok: true, names: ["Player 1", "Player 2"] });
  });

  it("refuses two names that read the same", () => {
    expect(checkNames(["asha", "Asha "])).toEqual({ ok: false, reason: "Choose two different names" });
  });

  it("refuses a name longer than the limit", () => {
    expect(checkNames(["A".repeat(MAX_NAME_LENGTH + 1), "Ben"])).toEqual({
      ok: false,
      reason: `Names can be at most ${MAX_NAME_LENGTH} letters`,
    });
  });
});

describe("createLocalMatch", () => {
  it("fails at once without an engine, a clock or an RNG", () => {
    expect(() => createLocalMatch({ clock: fakeClock(), rng: fixedRng(0) })).toThrow(TypeError);
    expect(() => createLocalMatch({ engine: rpsEngine, rng: fixedRng(0) })).toThrow(TypeError);
    expect(() => createLocalMatch({ engine: rpsEngine, clock: fakeClock() })).toThrow(TypeError);
  });

  it("starts a game with the engine's own first state and both names", () => {
    const { match } = controllerFor(rpsEngine);

    const session = match.start({ names: NAMES, options: { bestOf: 3 } });

    expect(session).toMatchObject({ gameId: "rps", names: NAMES, number: 1, uncoveredFor: "" });
    expect(session.state).toEqual(rpsEngine.init({ players: [P1, P2], options: { bestOf: 3 } }));
    expect(Object.isFrozen(session)).toBe(true);
  });

  it("refuses options the engine refuses", () => {
    const { match } = controllerFor(rpsEngine);

    expect(() => match.start({ names: NAMES, options: { bestOf: 4 } })).toThrow(RangeError);
  });

  it("refuses names that checkNames refuses", () => {
    const { match } = controllerFor(rpsEngine);

    expect(() => match.start({ names: ["Ben", "ben"], options: {} })).toThrow(RangeError);
  });

  it("gives the phone to the player the engine says moves first", () => {
    const { match } = controllerFor(tictactoeEngine, { rng: fixedRng(0.9) });

    const session = match.start({ names: NAMES, options: {} });

    expect(match.holder(session)).toBe(P2);
  });

  it("plays a move for the player holding the phone and passes the phone on", () => {
    const { match } = controllerFor(tictactoeEngine);
    const session = match.start({ names: NAMES, options: {} });

    const next = play(match, session, { cell: 4 });

    expect(next.state.board[4]).toBe("X");
    expect(match.holder(next)).toBe(P2);
    expect(session.state.board[4]).toBe("");
  });

  it("refuses a move the engine refuses, in its words, and keeps the session", () => {
    const { match } = controllerFor(tictactoeEngine);
    const session = play(match, match.start({ names: NAMES, options: {} }), { cell: 4 });

    const result = match.move(session, { cell: 4 });

    expect(result).toEqual({ ok: false, error: { code: "ILLEGAL_MOVE", message: "That cell is taken" } });
  });

  it("refuses any move once the game is over", () => {
    const { match } = controllerFor(tictactoeEngine);
    let session = match.start({ names: NAMES, options: {} });
    for (const cell of [0, 3, 1, 4, 2]) session = play(match, session, { cell });

    expect(match.holder(session)).toBe("");
    expect(match.move(session, { cell: 8 })).toMatchObject({ ok: false, error: { code: "GAME_OVER" } });
  });
});

describe("the room view a board is drawn from", () => {
  it.each([rpsEngine, tictactoeEngine, chessEngine])(
    "seats the players $id lists, in its order, with the names in the same order (CC-253)",
    (engine) => {
      const { match } = controllerFor(engine);
      const session = match.start({ names: NAMES, options: {} });

      const room = match.roomView(session);

      expect(room.seats.map((seat) => seat.playerId)).toEqual(engine.playersOf(session.state));
      expect(room.seats.map((seat) => [seat.playerId, seat.displayName])).toEqual([
        [P1, NAMES[0]],
        [P2, NAMES[1]],
      ]);
    },
  );

  it("seats both names and gives the view of the player holding the phone", () => {
    const { match } = controllerFor(rpsEngine);
    const session = play(match, match.start({ names: NAMES, options: {} }), { choice: "rock" });

    const room = match.roomView(session);

    expect(room).toMatchObject({
      gameId: "rps",
      status: "playing",
      you: P2,
      sharedScreen: true,
      hostId: "",
      players: { min: 2, max: 2 },
      requests: [],
      serverTime: START,
    });
    expect(room.seats.map((seat) => seat.displayName)).toEqual(NAMES);
    expect(room.game).toMatchObject({ number: 1, activePlayers: [P2], outcome: { status: "ongoing" } });
    expect(room.game.view.hasChosen).toEqual({ [P1]: true, [P2]: false });
  });

  it("never puts the first player's secret choice in the second player's view", () => {
    const { match } = controllerFor(rpsEngine);
    const session = play(match, match.start({ names: NAMES, options: {} }), { choice: "scissors" });

    expect(JSON.stringify(match.roomView(session))).not.toContain("scissors");
  });

  it("shows a finished game to both players at once, as if watching", () => {
    const { match } = controllerFor(rpsEngine);
    let session = match.start({ names: NAMES, options: { bestOf: 1 } });
    session = play(match, session, { choice: "rock" });
    session = play(match, session, { choice: "scissors" });

    const room = match.roomView(session);

    expect(room).toMatchObject({ status: "finished", you: "" });
    expect(room.game.outcome).toMatchObject({ status: "finished", winners: [P1] });
    expect(room.game.activePlayers).toEqual([]);
  });

  it("dates the view at the last change, so the clocks count from it", () => {
    const { match, clock } = controllerFor(tictactoeEngine);
    const session = match.start({ names: NAMES, options: {} });
    clock.advance(5_000);

    const next = play(match, session, { cell: 0 });

    expect(match.roomView(session).serverTime).toBe(START);
    expect(match.roomView(next).serverTime).toBe(START + 5_000);
  });
});

describe("covering the board between players", () => {
  it("covers the board until the player holding the phone uncovers it", () => {
    const { match } = controllerFor(rpsEngine);
    const session = match.start({ names: NAMES, options: {} });

    expect(match.covered(session)).toBe(true);
    expect(match.covered(match.uncover(session))).toBe(false);
  });

  it("covers it again as soon as the phone must go to the other player", () => {
    const { match } = controllerFor(rpsEngine);
    const session = match.uncover(match.start({ names: NAMES, options: {} }));

    const next = play(match, session, { choice: "paper" });

    expect(match.holder(next)).toBe(P2);
    expect(match.covered(next)).toBe(true);
  });

  it("never covers a finished game", () => {
    const { match } = controllerFor(rpsEngine);
    let session = match.start({ names: NAMES, options: { bestOf: 1 } });
    session = play(match, match.uncover(session), { choice: "rock" });
    session = play(match, match.uncover(session), { choice: "paper" });

    expect(match.covered(session)).toBe(false);
  });

  it("names the last round for the hand-over screen", () => {
    const { match } = controllerFor(rpsEngine);
    let session = match.start({ names: NAMES, options: {} });
    session = play(match, session, { choice: "rock" });
    session = play(match, session, { choice: "scissors" });

    expect(match.roomView(session).game.view.rounds).toEqual([
      { choices: { [P1]: "rock", [P2]: "scissors" }, winner: P1 },
    ]);
  });
});

describe("chess clocks and requests", () => {
  it("ends the game on time when the engine's deadline passes", () => {
    const { match, clock } = controllerFor(chessEngine);
    let session = match.start({ names: NAMES, options: { timeControl: "bullet-1+0" } });
    session = play(match, session, { type: "move", from: "e2", to: "e4" });

    expect(match.deadline(session)).toBe(START + 60_000);
    expect(match.expire(session)).toBe(session);

    clock.advance(60_000);
    const ended = match.expire(session);

    expect(match.roomView(ended)).toMatchObject({ status: "finished" });
    expect(ended.state.end).toEqual({ reason: "timeout", winner: P1 });
  });

  it("has no deadline for a game without a clock", () => {
    const { match } = controllerFor(tictactoeEngine);
    const session = match.start({ names: NAMES, options: {} });

    expect(match.deadline(session)).toBe(0);
    expect(match.expire(session)).toBe(session);
  });

  it("ends the game in a draw when the other player accepts a draw offer", () => {
    const { match } = controllerFor(chessEngine);
    const session = match.start({ names: NAMES, options: {} });

    const drawn = match.accept(session, CHESS_REQUEST_TYPES.DRAW);

    expect(match.roomView(drawn).game.outcome).toMatchObject({ result: "draw", reason: "agreement" });
  });

  it("refuses a request the game does not have", () => {
    const { match } = controllerFor(tictactoeEngine);
    const session = match.start({ names: NAMES, options: {} });

    expect(() => match.accept(session, "draw")).toThrow(TypeError);
  });

  it("lets the player who is not to move resign too, and the side to move wins", () => {
    const { match } = controllerFor(chessEngine);
    const session = match.start({ names: NAMES, options: {} });

    const result = match.moveAs(session, { playerId: P2, move: { type: "resign" } });

    expect(match.holder(session)).toBe(P1);
    expect(match.roomView(result.session).game.outcome).toMatchObject({ result: "win", winners: [P1] });
  });

  it("refuses a move for a player when the engine refuses it, such as a board move out of turn", () => {
    const { match } = controllerFor(chessEngine);
    const session = match.start({ names: NAMES, options: {} });

    const result = match.moveAs(session, { playerId: P2, move: { type: "move", from: "e7", to: "e5" } });

    expect(result).toMatchObject({ ok: false, error: { code: "NOT_YOUR_TURN" } });
  });

  it("tells what a move would end in without playing it, for the confirmation", () => {
    const { match } = controllerFor(chessEngine);
    const session = match.start({ names: NAMES, options: {} });

    expect(match.outcomeIf(session, { playerId: P1, move: { type: "resign" } })).toMatchObject({
      status: "finished",
      winners: [P2],
    });
    expect(match.outcomeIf(session, { playerId: P2, move: { type: "move", from: "e7", to: "e5" } })).toBe(
      undefined,
    );
    expect(match.holder(session)).toBe(P1);
  });

  it("lets the side to move resign, and the other side wins", () => {
    const { match } = controllerFor(chessEngine);
    const session = match.start({ names: NAMES, options: {} });

    const ended = play(match, session, { type: "resign" });

    expect(match.roomView(ended).game.outcome).toMatchObject({ result: "win", winners: [P2] });
  });
});

describe("playing again", () => {
  it("starts a fresh game with the same names and options, numbered on", () => {
    const { match } = controllerFor(tictactoeEngine, { rng: fixedRng(0) });
    let session = match.start({ names: NAMES, options: {} });
    session = play(match, session, { cell: 0 });

    const again = match.playAgain(session);

    expect(again).toMatchObject({ names: NAMES, number: 2, uncoveredFor: "" });
    expect(again.state.board.every((cell) => cell === "")).toBe(true);
    expect(match.roomView(again).game.number).toBe(2);
  });
});
