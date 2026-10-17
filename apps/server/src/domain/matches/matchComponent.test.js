import { describe, expect, it } from "vitest";
import { createMatchAccessor } from "../../data/matchAccessor.js";
import { createInMemoryMatchDao } from "../../testing/inMemoryMatchDao.js";
import { NotFoundError } from "../../utils/errors.js";
import { NOT_COUNTED_REASONS } from "@classicade/shared";
import { FAIR_PLAY_LIMITS } from "./fairPlay.js";
import { createMatchComponent } from "./matchComponent.js";

// 2025-10-09 09:00 UTC: early enough that a test's games stay in one UTC day.
const T0 = Date.UTC(2025, 9, 9, 9);
const DAY = 86_400_000;
const room = (overrides = {}) => ({
  code: "ROOM22",
  gameId: "rps",
  options: { bestOf: 1 },
  status: "finished",
  hostId: "guest_a",
  seats: [
    { playerId: "guest_a", displayName: "Alice", connected: true },
    { playerId: "guest_b", displayName: "Bob", connected: false },
  ],
  game: {
    matchId: "00000000-0000-4000-8000-000000000001",
    seed: 7,
    startedAt: T0,
    state: { secret: "engine internals" },
    log: [{ kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: T0 + 1 }],
  },
  createdAt: T0 - 1_000,
  lastActivityAt: T0 + 9_000,
  version: 7,
  ...overrides,
});
const WIN_A = { status: "finished", result: "win", winners: ["guest_a"], reason: "best-of-1" };
const DRAW = { status: "finished", result: "draw", winners: [], reason: "agreement" };
const setup = () =>
  createMatchComponent({ matchAccessor: createMatchAccessor({ matchDao: createInMemoryMatchDao() }) });

describe("matchComponent", () => {
  it("records a finished room as a match: players, seed, log, result and timing — not engine state", async () => {
    const matches = setup();

    const match = await matches.recordFinished({ room: room(), outcome: WIN_A });

    expect(match).toEqual({
      matchId: "00000000-0000-4000-8000-000000000001",
      roomCode: "ROOM22",
      gameId: "rps",
      options: { bestOf: 1 },
      seed: 7,
      players: [
        { playerId: "guest_a", displayName: "Alice" },
        { playerId: "guest_b", displayName: "Bob" },
      ],
      log: [{ kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: T0 + 1 }],
      result: { result: "win", winners: ["guest_a"], reason: "best-of-1" },
      startedAt: T0,
      endedAt: T0 + 9_000,
    });
  });

  it.each([
    ["guest_a", WIN_A, "win"],
    ["guest_b", WIN_A, "loss"],
    ["guest_b", DRAW, "draw"],
  ])("tells %s how the match went (%o → %s)", async (playerId, outcome, expected) => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome });

    const [summary] = await matches.listForPlayer({ playerId, limit: 10 });

    expect(summary.outcomeForYou).toBe(expected);
    expect(summary).not.toHaveProperty("log");
  });

  it("gives participants the full record, including the log", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: WIN_A });

    const match = await matches.getForPlayer({ matchId: room().game.matchId, playerId: "guest_b" });

    expect(match.log).toHaveLength(1);
    expect(match.outcomeForYou).toBe("loss");
  });

  it("hides a match from non-participants as 'not found', so ids cannot be probed", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: WIN_A });

    await expect(matches.getForPlayer({ matchId: room().game.matchId, playerId: "guest_x" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("fails fast without an accessor", () => {
    expect(() => createMatchComponent({})).toThrow(TypeError);
  });
});

describe("matchComponent: judging whether a match counts (CC-095)", () => {
  const ALICE = { playerId: "guest_a", displayName: "Alice", connected: true };
  const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };
  const twoMovesEach = [ALICE, BOB, ALICE, BOB].map(({ playerId }) => ({
    kind: "move",
    playerId,
    move: {},
    at: T0,
  }));
  const finished = (
    matches,
    matchId,
    { log = twoMovesEach, endedAt = T0 + 9_000, seats = [ALICE, BOB] } = {},
  ) =>
    matches.recordFinished({
      room: room({ seats, lastActivityAt: endedAt, game: { ...room().game, matchId, log } }),
      outcome: WIN_A,
    });

  it("stores that a game played long enough counts for both, and history says so", async () => {
    const matches = setup();

    const judged = await matches.judge(await finished(matches, "m1"));

    expect(judged.credit).toEqual({ notCounted: [] });
    const [summary] = await matches.listForPlayer({ playerId: "guest_b", limit: 10 });
    expect(summary.countsForYou).toEqual({ counted: true });
  });

  it("stores that a game nobody played long enough counts for nobody", async () => {
    const matches = setup();

    const judged = await matches.judge(await finished(matches, "m1", { log: room().game.log }));

    expect(judged.credit.notCounted).toEqual([
      { playerId: "guest_a", reason: NOT_COUNTED_REASONS.ENDED_TOO_SOON },
      { playerId: "guest_b", reason: NOT_COUNTED_REASONS.ENDED_TOO_SOON },
    ]);
    const mine = await matches.getForPlayer({ matchId: "m1", playerId: "guest_a" });
    expect(mine.countsForYou).toEqual({ counted: false, reason: NOT_COUNTED_REASONS.ENDED_TOO_SOON });
    expect(mine).not.toHaveProperty("credit");
  });

  it("stops counting games between the same two players after the daily limit, and the next day counts again", async () => {
    const matches = setup();
    const limit = FAIR_PLAY_LIMITS.GAMES_PER_OPPONENT_PER_DAY;
    for (let i = 0; i < limit; i++) {
      await matches.judge(await finished(matches, `m-${i}`, { endedAt: T0 + i }));
    }

    const over = await matches.judge(await finished(matches, "m-over", { endedAt: T0 + limit }));
    const tomorrow = await matches.judge(await finished(matches, "m-tomorrow", { endedAt: T0 + DAY }));

    expect(over.credit.notCounted.map((e) => e.reason)).toEqual([
      NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT,
      NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT,
    ]);
    expect(tomorrow.credit.notCounted).toEqual([]);
  });

  it("keeps the first verdict when the same match is judged again", async () => {
    const matches = setup();
    const recorded = await finished(matches, "m1", { log: room().game.log });
    const first = await matches.judge(recorded);

    expect(await matches.judge(first)).toBe(first);
    expect((await matches.judge(recorded)).credit).toEqual(first.credit);
  });
});

describe("matchComponent: a guest's history moving to their account (CC-032)", () => {
  const ACCOUNT = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
  const withMatch = (matchId, seats, endedAt = T0 + 9_000) =>
    room({ seats, lastActivityAt: endedAt, game: { ...room().game, matchId } });
  const ALICE = { playerId: "guest_a", displayName: "Alice", connected: true };
  const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };

  it("rewrites the guest's matches as the account's: seats, moves and winners", async () => {
    const matches = setup();
    await matches.recordFinished({ room: withMatch("m1", [ALICE, BOB]), outcome: WIN_A });

    const result = await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });
    const moved = await matches.getForPlayer({ matchId: "m1", playerId: ACCOUNT.id });

    expect(result).toEqual({ moved: { matches: 1 } });
    expect(moved.players).toEqual([
      { playerId: ACCOUNT.id, displayName: "Riya" },
      { playerId: "guest_b", displayName: "Bob" },
    ]);
    expect(moved.log[0].playerId).toBe(ACCOUNT.id);
    expect(moved.result.winners).toEqual([ACCOUNT.id]);
    expect(moved.outcomeForYou).toBe("win");
    expect(await matches.listForPlayer({ playerId: "guest_a", limit: 10 })).toEqual([]);
  });

  it("leaves a match the guest played against the same account as it is", async () => {
    const matches = setup();
    const accountSeat = { playerId: ACCOUNT.id, displayName: "Riya", connected: true };
    await matches.recordFinished({ room: withMatch("m-self", [ALICE, accountSeat]), outcome: WIN_A });

    const result = await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    expect(result).toEqual({ moved: { matches: 0 } });
    expect((await matches.getById("m-self")).players[0].playerId).toBe("guest_a");
  });

  it("moves nothing the second time", async () => {
    const matches = setup();
    await matches.recordFinished({ room: withMatch("m1", [ALICE, BOB]), outcome: WIN_A });
    await matches.recordFinished({ room: withMatch("m2", [BOB, ALICE], T0 + 20_000), outcome: WIN_A });
    await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    const again = await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    expect(again).toEqual({ moved: { matches: 0 } });
    expect(await matches.listForPlayer({ playerId: ACCOUNT.id, limit: 10 })).toHaveLength(2);
  });

  describe("fair play limits for the account's day as a whole (CC-095)", () => {
    const CAROL = { playerId: "guest_c", displayName: "Carol", connected: true };
    const accountSeat = { playerId: ACCOUNT.id, displayName: "Riya", connected: true };
    /** A judged game between two seats, one move each, ending `n` ms after T0. */
    async function played(matches, matchId, seats, n) {
      const log = seats.map(({ playerId }) => ({ kind: "move", playerId, move: {}, at: T0 }));
      const recorded = await matches.recordFinished({
        room: room({ seats, lastActivityAt: T0 + n, game: { ...room().game, matchId, log } }),
        outcome: WIN_A,
      });
      return matches.judge(recorded);
    }
    const limit = FAIR_PLAY_LIMITS.GAMES_PER_OPPONENT_PER_DAY;

    it("stops counting a guest's game once the account's own games reach a limit, naming the guest", async () => {
      const matches = setup();
      for (let i = 0; i < limit - 1; i++) {
        await played(matches, `m-own-${i}`, [accountSeat, BOB], i);
      }
      await played(matches, "m-guest-1", [ALICE, BOB], 100);
      await played(matches, "m-guest-2", [ALICE, BOB], 101);
      await played(matches, "m-guest-carol", [ALICE, CAROL], 102);

      await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

      const countsFor = async (matchId) =>
        (await matches.getForPlayer({ matchId, playerId: ACCOUNT.id })).countsForYou;
      expect(await countsFor("m-guest-1")).toEqual({ counted: true });
      expect(await countsFor("m-guest-2")).toEqual({
        counted: false,
        reason: NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT,
      });
      expect(await countsFor("m-guest-carol")).toEqual({ counted: true });
      expect((await matches.getById("m-guest-2")).credit.notCounted).toEqual([
        { playerId: ACCOUNT.id, reason: NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT, withdrawnFrom: "guest_a" },
      ]);
    });

    it("keeps a guest's game that never counted as it was, and leaves an unjudged one for the pipeline", async () => {
      const matches = setup();
      await matches.recordFinished({ room: withMatch("m-short", [ALICE, BOB]), outcome: WIN_A });
      await matches.judge(await matches.getById("m-short"));
      await matches.recordFinished({ room: withMatch("m-unjudged", [ALICE, BOB]), outcome: WIN_A });

      await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

      expect((await matches.getById("m-short")).credit.notCounted).toEqual([
        { playerId: ACCOUNT.id, reason: NOT_COUNTED_REASONS.ENDED_TOO_SOON },
        { playerId: "guest_b", reason: NOT_COUNTED_REASONS.ENDED_TOO_SOON },
      ]);
      expect(await matches.getById("m-unjudged")).not.toHaveProperty("credit");
    });
  });

  it("counts only the matches it renamed itself when another move got there first", async () => {
    const dao = createInMemoryMatchDao();
    const accessor = createMatchAccessor({ matchDao: dao });
    const racing = createMatchComponent({
      matchAccessor: {
        ...accessor,
        // Another run renames the match between the listing and the write.
        listExcluding: async (...args) => {
          const listed = await accessor.listExcluding(...args);
          await createMatchComponent({ matchAccessor: accessor }).transferPlayer({
            from: "guest_a",
            to: ACCOUNT,
            now: T0,
          });
          return listed;
        },
      },
    });
    await racing.recordFinished({ room: withMatch("m1", [ALICE, BOB]), outcome: WIN_A });

    expect(await racing.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 })).toEqual({
      moved: { matches: 0 },
    });
  });
});
