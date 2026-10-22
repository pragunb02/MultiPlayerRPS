import { describe, expect, it } from "vitest";
import { chessReasonPhrase } from "./chess/chessAlerts.js";
import { resultHeadline } from "./outcomeText.js";
import { matchPhase, PLAY_REASONS, playReason } from "./roomView.js";
import { rpsReasonPhrase } from "./rps/rpsAlerts.js";
import { tictactoeReasonPhrase } from "./tictactoe/tictactoeAlerts.js";

const seats = [
  { playerId: "a", displayName: "Alice", connected: true },
  { playerId: "b", displayName: "Bob", connected: true },
];
const finished = (gameId, outcome, you = "a") => ({
  gameId,
  you,
  status: "finished",
  seats,
  game: { view: {}, activePlayers: [], outcome },
});
const win = (winner, reason) => ({ result: "win", winners: [winner], reason });
const draw = (reason) => ({ result: "draw", winners: [], reason });

describe("the result headline names how the game ended (CC-162)", () => {
  it.each([
    ["chess", win("a", "checkmate"), "You won by checkmate"],
    ["chess", win("b", "timeout"), "You lost on time"],
    ["chess", win("a", "resignation"), "You won by resignation"],
    ["chess", draw("agreement"), "Draw by agreement"],
    ["chess", draw("stalemate"), "Draw by stalemate"],
    ["tictactoe", win("a", "three-in-a-row"), "You won with three in a row"],
    ["tictactoe", win("b", "three-in-a-row"), "You lost to three in a row"],
    ["tictactoe", draw("board-full"), "Draw with a full board"],
    ["rps", win("b", "best-of-3"), "You lost the best of 3"],
    ["rps", win("a", "forfeit"), "You won by forfeit"],
    ["tictactoe", win("a", "idle"), "You won on the move timer"],
    ["rps", win("b", "idle"), "You lost on the move timer"],
    ["rps", draw("idle"), "Draw on the move timer"],
    ["chess", { result: "aborted", winners: [], reason: "aborted" }, "Game aborted"],
  ])("%s: %o reads %s", (gameId, outcome, text) => {
    expect(resultHeadline(finished(gameId, outcome))).toBe(text);
  });

  it("tells a spectator who won and how", () => {
    expect(resultHeadline(finished("chess", win("b", "checkmate"), ""))).toBe("Bob won by checkmate");
    expect(resultHeadline(finished("tictactoe", win("b", "three-in-a-row"), ""))).toBe(
      "Bob won with three in a row",
    );
    expect(resultHeadline(finished("chess", win("gone", "forfeit"), ""))).toBe("Someone won by forfeit");
  });

  it("keeps the plain result for a reason or a game this version does not know", () => {
    expect(resultHeadline(finished("chess", win("a", "meteor")))).toBe("You won!");
    expect(resultHeadline(finished("ludo", win("b", "home-run")))).toBe("You lost");
    expect(resultHeadline(finished("ludo", draw("tie")))).toBe("It's a draw");
    expect(resultHeadline(finished("ludo", win("b", "home-run"), ""))).toBe("Bob won");
  });

  it("words every chess ending, and nothing for one it does not know", () => {
    expect(
      [
        "insufficient-material",
        "threefold-repetition",
        "fifty-move-rule",
        "timeout-vs-insufficient-material",
        "next-year",
      ].map(chessReasonPhrase),
    ).toEqual([
      "by insufficient material",
      "by threefold repetition",
      "by the fifty-move rule",
      "on time with too little material to win",
      "",
    ]);
  });

  it("words Rock Paper Scissors and Tic-Tac-Toe endings, and nothing for unknown ones", () => {
    expect(rpsReasonPhrase("best-of-5")).toBe("the best of 5");
    expect(rpsReasonPhrase("sudden-death")).toBe("");
    expect(tictactoeReasonPhrase("four-in-a-row")).toBe("");
  });
});

describe("where the match stands and why the board is closed (CC-164)", () => {
  const room = (overrides = {}) => ({
    you: "a",
    status: "playing",
    seats,
    game: { activePlayers: ["a"] },
    ...overrides,
  });

  it.each([
    [room(), "my-turn", ""],
    [room({ game: { activePlayers: ["b"] } }), "their-turn", PLAY_REASONS.NOT_YOUR_TURN],
    [room({ status: "waiting", game: undefined }), "waiting", PLAY_REASONS.WAITING],
    [room({ status: "finished", game: { activePlayers: [] } }), "finished", PLAY_REASONS.OVER],
    [room({ you: "" }), "watching", PLAY_REASONS.WATCHING],
  ])("reads %o as %s", (view, phase, reason) => {
    expect(matchPhase(view)).toBe(phase);
    expect(playReason(view, { reconnecting: false })).toBe(reason);
  });

  it("says Reconnecting before anything else while the connection is being restored", () => {
    expect(playReason(room(), { reconnecting: true })).toBe("Reconnecting. Your move can wait.");
    expect(playReason(room({ you: "" }), { reconnecting: true })).toBe("Reconnecting. Your move can wait.");
  });

  it.each([
    ["a turn limit", room({ game: { activePlayers: ["a"], turnEndsAt: 90_000 } })],
    [
      "a running chess clock",
      room({ game: { activePlayers: ["a"], view: { clocks: { w: 60_000, b: 60_000 }, lastMoveAt: 5_000 } } }),
    ],
  ])("never says the move can wait while %s runs (CC-350)", (_case, view) => {
    expect(playReason(view, { reconnecting: true })).toBe("Reconnecting… Your clock may still be running.");
  });

  it("says the move can wait when the clock has not started and no turn limit applies", () => {
    const view = room({
      game: { activePlayers: ["a"], turnEndsAt: 0, view: { clocks: { w: 1, b: 1 }, lastMoveAt: 0 } },
    });

    expect(playReason(view, { reconnecting: true })).toBe("Reconnecting. Your move can wait.");
  });
});
