import { describe, expect, it } from "vitest";
import { NOT_COUNTED_REASONS } from "@classicade/shared";
import {
  botXpFor,
  botXpLeftAfter,
  creditFor,
  endedTooSoon,
  FAIR_PLAY_LIMITS,
  hasComputerPlayer,
  judgeMatch,
  limitWindowOf,
  utcDayOf,
  xpFor,
} from "./fairPlay.js";

const HOUR = 3_600_000;
// 2026-10-16 00:00 UTC, the start of a UTC day.
const MIDNIGHT = Date.UTC(2026, 9, 16);
const NOON = MIDNIGHT + 12 * HOUR;
const A = "guest_a";
const B = "guest_b";
const C = "guest_c";

const move = (playerId) => ({ kind: "move", playerId, move: {}, at: NOON });
const forfeitBy = (playerId) => ({ kind: "forfeit", playerId, at: NOON });

/** A recorded match between A and B that A won by the rules, ending at noon, after two moves each. */
const match = (overrides = {}) => ({
  matchId: "m-this",
  gameId: "tictactoe",
  players: [
    { playerId: A, displayName: "A" },
    { playerId: B, displayName: "B" },
  ],
  log: [move(A), move(B), move(A), move(B)],
  result: { result: "win", winners: [A], reason: "three-in-a-row" },
  startedAt: NOON - 60_000,
  endedAt: NOON,
  ...overrides,
});
const leftBy = (leaver, log) =>
  match({ log: [...log, forfeitBy(leaver)], result: { result: "win", winners: [A], reason: "forfeit" } });

let gameNumber = 0;
/** `count` other counted games of A against `opponent`, ending at `at`. */
const games = (count, { opponent = B, at = NOON - HOUR } = {}) =>
  Array.from({ length: count }, () => ({
    matchId: `m-${++gameNumber}`,
    players: [{ playerId: A }, { playerId: opponent }],
    endedAt: at,
  }));
const judgeA = (others, overrides) => judgeMatch({ match: match(overrides), playerId: A, others });
const COUNTED = { counted: true };
const notCounted = (reason) => ({ counted: false, reason });
const PAIR = FAIR_PLAY_LIMITS.GAMES_PER_OPPONENT_PER_DAY;
const HOURLY = FAIR_PLAY_LIMITS.GAMES_PER_HOUR;

describe("utcDayOf", () => {
  it.each([
    ["midnight", MIDNIGHT],
    ["noon", NOON],
    ["the last ms of the day", MIDNIGHT + 24 * HOUR - 1],
  ])("puts %s in its UTC day", (_when, at) => {
    expect(utcDayOf(at)).toEqual({ from: MIDNIGHT, to: MIDNIGHT + 24 * HOUR });
  });
});

describe("endedTooSoon", () => {
  it.each([
    ["two moves each, played to the end", match(), false],
    ["one move each, played to the end (a one round RPS match)", match({ log: [move(A), move(B)] }), false],
    ["a player who never moved, though the rules ended it", match({ log: [move(A)] }), true],
    ["nobody moved", match({ log: [] }), true],
    ["left before moving", leftBy(B, [move(A)]), true],
    ["left after one move each", leftBy(B, [move(A), move(B)]), true],
    [
      "left once the leaver made two moves but the other only one",
      leftBy(B, [move(A), move(B), move(B)]),
      true,
    ],
    ["left after two moves each", leftBy(B, [move(A), move(B), move(A), move(B)]), false],
    [
      "stopped playing after one move each until the idle limit ended it (CC-036)",
      match({
        log: [move(A), move(B), { kind: "idle", playerIds: [B], at: NOON }],
        result: { result: "win", winners: [A], reason: "idle" },
      }),
      true,
    ],
    [
      "stopped playing after two moves each",
      match({
        log: [move(A), move(B), move(A), move(B), { kind: "idle", playerIds: [B], at: NOON }],
        result: { result: "win", winners: [A], reason: "idle" },
      }),
      false,
    ],
  ])("%s: %s", (_case, m, expected) => {
    expect(endedTooSoon(m)).toBe(expected);
  });

  it("counts only moves: forfeits and clock expiries are not moves", () => {
    const m = match({ log: [move(A), forfeitBy(B), { kind: "expire", at: NOON }] });

    expect(endedTooSoon(m)).toBe(true);
  });
});

describe("judgeMatch", () => {
  it("counts a game played long enough by players under every limit", () => {
    expect(judgeA([])).toEqual(COUNTED);
  });

  it("does not count a game that ended too soon, for anyone", () => {
    const m = leftBy(B, [move(A)]);

    expect(judgeMatch({ match: m, playerId: A, others: [] })).toEqual(
      notCounted(NOT_COUNTED_REASONS.ENDED_TOO_SOON),
    );
    expect(judgeMatch({ match: m, playerId: B, others: [] })).toEqual(
      notCounted(NOT_COUNTED_REASONS.ENDED_TOO_SOON),
    );
  });

  describe("daily limit per opponent", () => {
    it(`counts the ${PAIR}th game against the same opponent in a UTC day`, () => {
      expect(judgeA(games(PAIR - 1))).toEqual(COUNTED);
    });

    it(`does not count the ${PAIR + 1}th`, () => {
      expect(judgeA(games(PAIR))).toEqual(notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT));
    });

    it("only counts games against that opponent", () => {
      expect(judgeA(games(PAIR, { opponent: C }))).toEqual(COUNTED);
    });

    it("looks back a rolling 24 hours, not to UTC midnight (ADR-021 amendment)", () => {
      const lateLastNight = games(PAIR, { at: MIDNIGHT - HOUR });

      expect(judgeA(lateLastNight, { endedAt: MIDNIGHT + HOUR })).toEqual(
        notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT),
      );
      expect(judgeA(lateLastNight, { endedAt: MIDNIGHT + 23 * HOUR - 1 })).toEqual(
        notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT),
      );
      expect(judgeA(lateLastNight, { endedAt: MIDNIGHT + 23 * HOUR })).toEqual(COUNTED);
    });

    it("also counts the next 24 hours' games, so games judged together or moved in later never exceed it", () => {
      expect(judgeA(games(PAIR, { at: NOON + HOUR }))).toEqual(
        notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT),
      );
      expect(judgeA(games(PAIR, { at: NOON + 24 * HOUR - 1 }))).toEqual(
        notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT),
      );
      expect(judgeA(games(PAIR, { at: NOON + 24 * HOUR }))).toEqual(COUNTED);
    });

    it("counts every level of a computer character as one opponent (ADR-025)", () => {
      const easy = games(PAIR / 2, { opponent: "bot_rocky_easy" });
      const hard = games(PAIR / 2, { opponent: "bot_rocky_hard" });
      const vsRocky = match({
        players: [{ playerId: A }, { playerId: "bot_rocky_hard" }],
        log: [move(A), move("bot_rocky_hard")],
      });

      expect(judgeMatch({ match: vsRocky, playerId: A, others: [...easy, ...hard] })).toEqual(
        notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT),
      );
      expect(judgeMatch({ match: vsRocky, playerId: A, others: easy })).toEqual(COUNTED);
    });

    it("keeps different characters apart", () => {
      const vsPip = match({
        players: [{ playerId: A }, { playerId: "bot_pip_easy" }],
        log: [move(A), move("bot_pip_easy")],
      });

      expect(
        judgeMatch({ match: vsPip, playerId: A, others: games(PAIR, { opponent: "bot_rocky_easy" }) }),
      ).toEqual(COUNTED);
    });

    it("ignores the match itself among the others", () => {
      const others = [...games(PAIR - 1), { matchId: "m-this", players: [{ playerId: A }], endedAt: NOON }];

      expect(judgeA(others)).toEqual(COUNTED);
    });

    it("applies to guests by their id like to anyone", () => {
      const m = match({ players: [{ playerId: B }, { playerId: A }] });

      expect(judgeMatch({ match: m, playerId: B, others: games(PAIR).map(swap) })).toEqual(
        notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT),
      );
    });
  });

  describe("hourly limit per player", () => {
    const spread = (count, at) =>
      Array.from({ length: count }, (_, i) => games(1, { opponent: `guest_${i}`, at })[0]);

    it(`counts the ${HOURLY}th game in a UTC clock hour`, () => {
      expect(judgeA(spread(HOURLY - 1, NOON), { endedAt: NOON + HOUR - 1 })).toEqual(COUNTED);
    });

    it(`does not count the ${HOURLY + 1}th`, () => {
      expect(judgeA(spread(HOURLY, NOON), { endedAt: NOON + HOUR - 1 })).toEqual(
        notCounted(NOT_COUNTED_REASONS.HOURLY_LIMIT),
      );
    });

    it("starts again at the top of the hour", () => {
      expect(judgeA(spread(HOURLY, NOON - 1))).toEqual(COUNTED);
    });

    it("names the opponent limit first when both are reached", () => {
      expect(judgeA([...games(PAIR, { at: NOON }), ...spread(HOURLY, NOON)])).toEqual(
        notCounted(NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT),
      );
    });
  });
});

describe("creditFor", () => {
  it("counts a match nobody judged (recorded before fair play existed)", () => {
    expect(creditFor(match(), A)).toEqual(COUNTED);
  });

  it("tells each player how a judged match counts for them", () => {
    const m = match({ credit: { notCounted: [{ playerId: B, reason: NOT_COUNTED_REASONS.HOURLY_LIMIT }] } });

    expect(creditFor(m, A)).toEqual(COUNTED);
    expect(creditFor(m, B)).toEqual(notCounted(NOT_COUNTED_REASONS.HOURLY_LIMIT));
  });

  it("returns frozen verdicts", () => {
    expect(Object.isFrozen(creditFor(match(), A))).toBe(true);
  });
});

describe("limitWindowOf", () => {
  it("reaches a day back and a day ahead, so it holds the UTC day, the hour and the rolling 24 hours", () => {
    expect(limitWindowOf(NOON)).toEqual({ from: NOON - 24 * HOUR, to: NOON + 24 * HOUR });
  });
});

describe("computer characters (ADR-025)", () => {
  const ROCKY = "bot_rocky_easy";
  const vsRocky = (overrides = {}) =>
    match({
      players: [
        { playerId: A, displayName: "A" },
        { playerId: ROCKY, displayName: "Rocky" },
      ],
      log: [move(A), move(ROCKY)],
      ...overrides,
    });
  /** Another game of A against Rocky, judged with `xp` for A, or not judged yet. */
  const judgedVsRocky = (xp, { at = NOON - HOUR, id = `m-${++gameNumber}` } = {}) => ({
    matchId: id,
    players: [{ playerId: A }, { playerId: ROCKY }],
    endedAt: at,
    ...(xp !== undefined && { credit: { notCounted: [], botXp: [{ playerId: A, xp, left: 0 }] } }),
  });
  const LIMIT = FAIR_PLAY_LIMITS.BOT_XP_PER_DAY;

  it("knows a match with a computer character from one between people", () => {
    expect(hasComputerPlayer(vsRocky())).toBe(true);
    expect(hasComputerPlayer(match())).toBe(false);
  });

  it(`gives the full award while the day's ${LIMIT} XP from computer games is not used up`, () => {
    expect(botXpFor({ match: vsRocky(), playerId: A, others: [], award: 30 })).toEqual({
      xp: 30,
      left: LIMIT - 30,
    });
  });

  it("gives only what is left of the day's limit, and nothing once it is used up", () => {
    const used = [judgedVsRocky(30), judgedVsRocky(30), judgedVsRocky(30)];

    expect(botXpFor({ match: vsRocky(), playerId: A, others: used, award: 30 })).toEqual({ xp: 10, left: 0 });
    expect(
      botXpFor({ match: vsRocky(), playerId: A, others: [...used, judgedVsRocky(10)], award: 30 }),
    ).toEqual({ xp: 0, left: 0 });
  });

  it("takes a computer game nobody judged yet at the most it can give, so it never gives too much", () => {
    const others = [judgedVsRocky(undefined), judgedVsRocky(undefined), judgedVsRocky(undefined)];

    expect(botXpFor({ match: vsRocky(), playerId: A, others, award: 30 })).toEqual({ xp: 10, left: 0 });
  });

  it("counts only the same UTC day, only games against computers, and never the match itself", () => {
    const others = [
      judgedVsRocky(30, { at: MIDNIGHT - 1 }),
      judgedVsRocky(30, { at: MIDNIGHT + 24 * HOUR }),
      judgedVsRocky(30, { id: "m-this" }),
      ...games(3),
    ];

    expect(botXpFor({ match: vsRocky(), playerId: A, others, award: 30 })).toEqual({
      xp: 30,
      left: LIMIT - 30,
    });
  });

  it("counts nothing for a judged computer game that gave this player no XP entry", () => {
    const other = { ...judgedVsRocky(30), credit: { notCounted: [] } };

    expect(botXpFor({ match: vsRocky(), playerId: A, others: [other], award: 30 }).left).toBe(LIMIT - 30);
  });

  it("reads the XP and what is left from the verdict, and the plain award elsewhere", () => {
    const judged = vsRocky({ credit: { notCounted: [], botXp: [{ playerId: A, xp: 10, left: 0 }] } });

    expect(xpFor(judged, A, 30)).toBe(10);
    expect(xpFor(match(), A, 30)).toBe(30);
    expect(botXpLeftAfter(judged, A)).toEqual([0]);
    expect(botXpLeftAfter(match(), A)).toEqual([]);
  });
});

/** The same game seen from the opponent: B played A. */
function swap(game) {
  return { ...game, players: [{ playerId: B }, { playerId: A }] };
}
