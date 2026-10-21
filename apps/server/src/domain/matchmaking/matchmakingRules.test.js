import { describe, expect, it } from "vitest";
import {
  MATCHMAKING_RULES,
  mayPair,
  nearbyPoolKeys,
  pickPartner,
  poolKeyOf,
  quickMatchOptions,
  ratingWindow,
  searchPlan,
  searchTimeoutMs,
  SKIP_REASONS,
} from "./matchmakingRules.js";

const NOW = 1_000_000;
const seeker = (
  playerId,
  { gameId = "rps", since = NOW, order = 1, rating, blocked = [], avoid = [] } = {},
) => ({
  playerId,
  gameId,
  since,
  order,
  rating,
  blocked: new Set(blocked),
  avoid: new Set(avoid),
});

describe("matchmaking rules (CC-051, ADR-079)", () => {
  it("never pairs a player with themself, across games, a blocked pair either way, or a pair that failed", () => {
    const pair = (a, b) => mayPair({ a, b, now: NOW, pairCount: 0 });

    expect(pair(seeker("a"), seeker("b"))).toBe(true);
    expect(pair(seeker("a"), seeker("a"))).toBe(false);
    expect(pair(seeker("a"), seeker("b", { gameId: "tictactoe" }))).toBe(false);
    expect(pair(seeker("a", { blocked: ["b"] }), seeker("b"))).toBe(false);
    expect(pair(seeker("a"), seeker("b", { blocked: ["a"] }))).toBe(false);
    expect(pair(seeker("a", { avoid: ["b"] }), seeker("b"))).toBe(false);
  });

  it("never pairs a pair at its daily cap, the fair play cap per pair (ADR-021.3)", () => {
    expect(MATCHMAKING_RULES.pairsPerDay).toBe(10);
    expect(mayPair({ a: seeker("a"), b: seeker("b"), now: NOW, pairCount: 9 })).toBe(true);
    expect(mayPair({ a: seeker("a"), b: seeker("b"), now: NOW, pairCount: 10 })).toBe(false);
  });

  it("widens the chess window from 100 by 50 a second, to at most 300", () => {
    expect(ratingWindow(0)).toBe(100);
    expect(ratingWindow(2_000)).toBe(200);
    expect(ratingWindow(4_000)).toBe(300);
    expect(ratingWindow(60_000)).toBe(300);
  });

  it("pairs chess within the window of the older search only", () => {
    const old = seeker("a", { gameId: "chess", rating: 1500, since: NOW - 2_000 });

    expect(
      mayPair({ a: old, b: seeker("b", { gameId: "chess", rating: 1700 }), now: NOW, pairCount: 0 }),
    ).toBe(true);
    expect(
      mayPair({ a: old, b: seeker("b", { gameId: "chess", rating: 1701 }), now: NOW, pairCount: 0 }),
    ).toBe(false);
  });

  it("puts chess in bands of 300 and looks in the band beside it, every other game in one pool", () => {
    expect(poolKeyOf({ gameId: "rps" })).toBe("rps");
    expect(poolKeyOf({ gameId: "chess", rating: 1500 })).toBe("chess:5");
    expect(nearbyPoolKeys({ gameId: "chess", rating: 1500 })).toEqual(["chess:4", "chess:5", "chess:6"]);
    expect(nearbyPoolKeys({ gameId: "tictactoe" })).toEqual(["tictactoe"]);
  });

  it("plays quick match chess at 3+2, one pool (ADR-051.6), and every other game at its defaults", () => {
    expect(quickMatchOptions("chess")).toEqual({ timeControl: "blitz-3+2" });
    expect(quickMatchOptions("rps")).toEqual({});
  });

  it("picks the partner who waited longest, first come first served", () => {
    const me = seeker("me", { since: NOW, order: 9 });
    const candidates = [
      seeker("late", { since: NOW - 100, order: 3 }),
      seeker("first", { since: NOW - 900, order: 1 }),
      seeker("blocked", { since: NOW - 2_000, order: 0, blocked: ["me"] }),
      seeker("same-ms", { since: NOW - 900, order: 2 }),
    ];

    expect(pickPartner({ seeker: me, candidates, now: NOW, pairCountOf: () => 0 }).playerId).toBe("first");
    expect(pickPartner({ seeker: me, candidates: [me], now: NOW, pairCountOf: () => 0 })).toBeUndefined();
  });

  it("searches 4 s until 20 searches found a person, then their 80th percentile wait, from 1 s to 4 s", () => {
    expect(searchTimeoutMs([])).toBe(4_000);
    expect(searchTimeoutMs(Array(19).fill(100))).toBe(4_000);
    const waits = Array.from({ length: 20 }, (_, index) => (index + 1) * 100);
    expect(searchTimeoutMs(waits)).toBe(1_600);
    expect(searchTimeoutMs(Array(20).fill(10))).toBe(1_000);
    expect(searchTimeoutMs(Array(20).fill(9_000))).toBe(4_000);
  });

  it("lets a probe look the full search time whatever the waits say, so the timeout can grow again", () => {
    const short = Array(20).fill(10);

    expect(MATCHMAKING_RULES.probeEvery).toBe(10);
    expect(searchPlan({ othersOnline: 3, partnerWaiting: false, recentWaits: short })).toEqual({
      search: true,
      timeoutMs: 1_000,
    });
    expect(searchPlan({ othersOnline: 3, partnerWaiting: false, recentWaits: short, probe: true })).toEqual({
      search: true,
      timeoutMs: 4_000,
    });
  });

  it("skips the search on an empty site, unless someone it could meet is searching (ADR-029)", () => {
    expect(searchPlan({ othersOnline: 0, partnerWaiting: false, recentWaits: [] })).toEqual({
      search: false,
      reason: SKIP_REASONS.EMPTY,
    });
    expect(searchPlan({ othersOnline: 0, partnerWaiting: true, recentWaits: [] })).toEqual({
      search: true,
      timeoutMs: 4_000,
    });
    expect(searchPlan({ othersOnline: 1, partnerWaiting: false, recentWaits: [] })).toEqual({
      search: true,
      timeoutMs: 4_000,
    });
  });
});
