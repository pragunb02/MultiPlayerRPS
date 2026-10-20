import { describe, expect, it } from "vitest";
import { NOT_COUNTED_REASONS } from "@classicade/shared";
import {
  CHESS_RATING_RULES,
  changeIn,
  isRatedGame,
  periodsBetween,
  ratedPlayers,
  ratingView,
  scoreOf,
  seedsOf,
} from "./chessRatingRules.js";

const DAY = 24 * 3_600_000;
const NOON = Date.UTC(2026, 9, 20, 12);
const A = "guest_a";
const B = "user_b";

/** A recorded chess game between A and B that A won by checkmate, counted for both. */
const chessMatch = (overrides = {}) => ({
  matchId: "m1",
  roomCode: "ABC123",
  gameId: "chess",
  players: [
    { playerId: A, displayName: "A" },
    { playerId: B, displayName: "B" },
  ],
  log: [],
  result: { result: "win", winners: [A], reason: "checkmate" },
  startedAt: NOON - 60_000,
  endedAt: NOON,
  credit: { notCounted: [] },
  ...overrides,
});
const notCounted = (playerId) => ({
  credit: { notCounted: [{ playerId, reason: NOT_COUNTED_REASONS.HOURLY_LIMIT }] },
});
const againstQueenVee = (level, overrides = {}) =>
  chessMatch({
    players: [
      { playerId: A, displayName: "A" },
      { playerId: `bot_queen-vee_${level}`, displayName: "Queen Vee" },
    ],
    credit: { notCounted: [], botXp: [{ playerId: A, xp: 30, left: 70 }] },
    ...overrides,
  });

describe("chess rating rules", () => {
  it("rates a chess game between two people that counts for both", () => {
    expect(ratedPlayers(chessMatch())).toEqual([A, B]);
  });

  it("rates no other game", () => {
    expect(ratedPlayers(chessMatch({ gameId: "tictactoe" }))).toEqual([]);
    expect(isRatedGame("chess")).toBe(true);
    expect(isRatedGame("rps")).toBe(false);
  });

  it("rates neither side when the game does not count for one of them", () => {
    expect(ratedPlayers(chessMatch(notCounted(B)))).toEqual([]);
    expect(ratedPlayers(chessMatch(notCounted(A)))).toEqual([]);
  });

  it("never rates a game against a computer character (ADR-025)", () => {
    expect(ratedPlayers(againstQueenVee("hard"))).toEqual([]);
  });

  it("never rates a game against a deleted player's stand-in", () => {
    const players = [
      { playerId: A, displayName: "A" },
      { playerId: "deleted_0000", displayName: "Deleted player" },
    ];

    expect(ratedPlayers(chessMatch({ players }))).toEqual([]);
  });

  it("scores a win 1, a draw a half and a loss or a forfeit 0", () => {
    const draw = chessMatch({ result: { result: "draw", winners: [], reason: "agreement" } });
    const forfeit = chessMatch({
      result: { result: "win", winners: [B], reason: "forfeit" },
      log: [{ kind: "forfeit", playerId: A, at: NOON }],
    });

    expect(scoreOf(chessMatch(), A)).toBe(1);
    expect(scoreOf(chessMatch(), B)).toBe(0);
    expect(scoreOf(draw, A)).toBe(0.5);
    expect(scoreOf(forfeit, A)).toBe(0);
    expect(scoreOf(forfeit, B)).toBe(1);
  });

  it("seeds the person from the level they picked against Queen Vee", () => {
    expect(seedsOf(againstQueenVee("easy"))).toEqual([{ playerId: A, level: "easy", rating: 1200 }]);
    expect(seedsOf(againstQueenVee("medium"))).toEqual([{ playerId: A, level: "medium", rating: 1500 }]);
    expect(seedsOf(againstQueenVee("hard"))).toEqual([{ playerId: A, level: "hard", rating: 1800 }]);
  });

  it("seeds nobody from a game that did not count for them, or from a game between people", () => {
    expect(seedsOf(againstQueenVee("hard", notCounted(A)))).toEqual([]);
    expect(seedsOf(chessMatch())).toEqual([]);
    expect(seedsOf(againstQueenVee("hard", { gameId: "tictactoe" }))).toEqual([]);
  });

  it("counts the rating periods between two moments at Lichess's pace", () => {
    expect(periodsBetween({ from: NOON, to: NOON + 10 * DAY })).toBeCloseTo(2.1436, 9);
    expect(periodsBetween({ from: 0, to: NOON })).toBe(0);
    expect(periodsBetween({ from: NOON, to: NOON - DAY })).toBe(0);
  });

  it("shows a rating rounded, and provisional for the first 10 games", () => {
    const rating = { rating: 1532.6, deviation: 87.4, volatility: 0.06, games: 9 };

    expect(ratingView(rating)).toEqual({ rating: 1533, deviation: 87, games: 9, provisional: true });
    expect(ratingView({ ...rating, games: CHESS_RATING_RULES.PROVISIONAL_GAMES }).provisional).toBe(false);
  });

  it("answers the change a match made, as the difference of the ratings shown", () => {
    const changes = [
      {
        matchId: "m1",
        at: NOON,
        before: { rating: 1500.4, deviation: 350, volatility: 0.06 },
        after: { rating: 1662.6, deviation: 290, volatility: 0.06 },
      },
    ];

    expect(changeIn({ changes }, "m1")).toEqual([163]);
    expect(changeIn({ changes }, "m2")).toEqual([]);
  });
});
