import { describe, expect, it } from "vitest";
import { createMatchAccessor } from "../../data/matchAccessor.js";
import { createInMemoryMatchDao } from "../../testing/inMemoryMatchDao.js";
import { TEST_MATCH_PLAYER_IDS } from "../../testing/matchPlayerIds.js";
import { NotFoundError } from "../../utils/errors.js";
import { NOT_COUNTED_REASONS } from "@classicade/shared";
import { FAIR_PLAY_LIMITS } from "./fairPlay.js";
import { createMatchComponent } from "./matchComponent.js";

// 2025-10-09 09:00 UTC: early enough that a test's games stay in one UTC day.
const T0 = Date.UTC(2025, 9, 9, 9);
const DAY = 86_400_000;
// A finished room. It finished at its last activity unless a test says otherwise.
const room = (overrides = {}) => finishedRoom({ lastActivityAt: T0 + 9_000, ...overrides });
const finishedRoom = ({ lastActivityAt, finishedAt = lastActivityAt, ...overrides }) => ({
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
  lastActivityAt,
  finishedAt,
  version: 7,
  ...overrides,
});
const WIN_A = { status: "finished", result: "win", winners: ["guest_a"], reason: "best-of-1" };
const DRAW = { status: "finished", result: "draw", winners: [], reason: "agreement" };
const setup = () =>
  createMatchComponent({
    matchAccessor: createMatchAccessor({ matchDao: createInMemoryMatchDao() }),
    matchPlayerIds: TEST_MATCH_PLAYER_IDS,
  });

describe("matchComponent", () => {
  it("ends the match when the game finished, even when the room changed after that (CC-111)", () => {
    const matches = setup();
    // A rematch request a minute later moved the room's last activity on.
    const later = room({ finishedAt: T0 + 9_000, lastActivityAt: T0 + 69_000 });

    expect(matches.finishedMatch({ room: later, outcome: WIN_A }).endedAt).toBe(T0 + 9_000);
  });

  it("turns a finished room into the match to record, without storing it, and records it once (CC-111)", async () => {
    const matches = setup();
    const finished = matches.finishedMatch({ room: room(), outcome: WIN_A });

    const first = await matches.record(finished);
    const again = await matches.record(finished);

    expect(finished).toEqual(first);
    expect(Object.isFrozen(finished)).toBe(true);
    expect(again).toEqual(first);
  });

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

describe("matchComponent: computer characters in history (ADR-025)", () => {
  it("labels a computer character among the players as a computer, in the list and in the details", async () => {
    const matches = setup();
    const seats = [
      { playerId: "guest_a", displayName: "Alice", connected: true },
      { playerId: "bot_rocky_easy", displayName: "Rocky", connected: true },
    ];
    await matches.recordFinished({ room: room({ seats }), outcome: WIN_A });

    const [listed] = await matches.listForPlayer({ playerId: "guest_a", limit: 10 });
    const details = await matches.getForPlayer({ matchId: listed.matchId, playerId: "guest_a" });

    // Every player is named by their id for this match (CC-297).
    const idOf = (playerId) => TEST_MATCH_PLAYER_IDS.playerIdIn(listed, playerId);
    const expected = [
      { playerId: idOf("guest_a"), displayName: "Alice" },
      { playerId: idOf("bot_rocky_easy"), displayName: "Rocky", computer: true },
    ];
    expect(listed.players).toEqual(expected);
    expect(details.players).toEqual(expected);
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

  it("stops counting games between the same two players after the limit, and 24 hours later counts again", async () => {
    const matches = setup();
    const limit = FAIR_PLAY_LIMITS.GAMES_PER_OPPONENT_PER_DAY;
    for (let i = 0; i < limit; i++) {
      await matches.judge(await finished(matches, `m-${i}`, { endedAt: T0 + i }));
    }

    const over = await matches.judge(await finished(matches, "m-over", { endedAt: T0 + limit }));
    const tomorrow = await matches.judge(
      await finished(matches, "m-tomorrow", { endedAt: T0 + limit + DAY }),
    );

    expect(over.credit.notCounted.map((e) => e.reason)).toEqual([
      NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT,
      NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT,
    ]);
    expect(tomorrow.credit.notCounted).toEqual([]);
  });

  describe("games against a computer character (ADR-025)", () => {
    const ROCKY = { playerId: "bot_rocky_easy", displayName: "Rocky", connected: true };
    const vsRocky = [ALICE, ROCKY, ALICE, ROCKY].map(({ playerId }) => ({
      kind: "move",
      playerId,
      move: {},
      at: T0,
    }));
    const againstRocky = (matches, matchId, endedAt = T0 + 9_000) =>
      finished(matches, matchId, { seats: [ALICE, ROCKY], log: vsRocky, endedAt });

    it("judges only the person, and stores the XP the game gives them and what is left of the day's limit", async () => {
      const matches = setup();

      const judged = await matches.judge(await againstRocky(matches, "m1"));

      expect(judged.credit).toEqual({
        notCounted: [],
        botXp: [{ playerId: "guest_a", xp: 30, left: FAIR_PLAY_LIMITS.BOT_XP_PER_DAY - 30 }],
      });
    });

    it("gives no more XP once the day's limit from computer games is used up, but the game still counts", async () => {
      const matches = setup();
      for (let i = 0; i < 3; i++) {
        await matches.judge(await againstRocky(matches, `m-${i}`, T0 + i));
      }

      const fourth = await matches.judge(await againstRocky(matches, "m-4", T0 + 3));
      const fifth = await matches.judge(await againstRocky(matches, "m-5", T0 + 4));

      expect(fourth.credit.botXp).toEqual([{ playerId: "guest_a", xp: 10, left: 0 }]);
      expect(fifth.credit).toEqual({ notCounted: [], botXp: [{ playerId: "guest_a", xp: 0, left: 0 }] });
    });

    it("stores no XP for a person the game does not count for", async () => {
      const matches = setup();
      const short = await finished(matches, "m1", { seats: [ALICE, ROCKY], log: room().game.log });

      const judged = await matches.judge(short);

      expect(judged.credit).toEqual({
        notCounted: [{ playerId: "guest_a", reason: NOT_COUNTED_REASONS.ENDED_TOO_SOON }],
      });
    });
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
    const moved = await matches.getById("m1");

    expect(result).toEqual({ moved: { matches: 1 } });
    expect((await matches.getForPlayer({ matchId: "m1", playerId: ACCOUNT.id })).outcomeForYou).toBe("win");
    expect(moved.players).toEqual([
      { playerId: ACCOUNT.id, displayName: "Riya" },
      { playerId: "guest_b", displayName: "Bob" },
    ]);
    expect(moved.log[0].playerId).toBe(ACCOUNT.id);
    expect(moved.result.winners).toEqual([ACCOUNT.id]);
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

    it("gives a guest's games against a computer only what the account has left of the day's limit (ADR-025)", async () => {
      const matches = setup();
      const rocky = { playerId: "bot_rocky_easy", displayName: "Rocky", connected: true };
      const pip = { playerId: "bot_pip_easy", displayName: "Pip", connected: true };
      // Nine losses give the account 90 of the day's 100 XP from computer games.
      for (let i = 0; i < 9; i++) {
        await played(matches, `m-own-${i}`, [accountSeat, rocky], i);
      }
      // The guest won both, 30 XP each as a guest.
      await played(matches, "m-guest-1", [ALICE, rocky], 100);
      await played(matches, "m-guest-2", [ALICE, pip], 101);

      await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

      expect((await matches.getById("m-guest-1")).credit).toEqual({
        notCounted: [],
        botXp: [{ playerId: ACCOUNT.id, xp: 10, left: 0, withdrawnFrom: "guest_a", withdrawnXp: 20 }],
      });
      expect((await matches.getById("m-guest-2")).credit.botXp).toEqual([
        { playerId: ACCOUNT.id, xp: 0, left: 0, withdrawnFrom: "guest_a", withdrawnXp: 30 },
      ]);
      // Both still count for the account's quests and history, only the XP is held to the limit.
      expect(
        (await matches.getForPlayer({ matchId: "m-guest-2", playerId: ACCOUNT.id })).countsForYou,
      ).toEqual({
        counted: true,
      });
    });

    it("leaves a guest's game against a computer as it was when the account has enough of the limit left", async () => {
      const matches = setup();
      const rocky = { playerId: "bot_rocky_easy", displayName: "Rocky", connected: true };
      await played(matches, "m-guest-1", [ALICE, rocky], 100);

      await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

      expect((await matches.getById("m-guest-1")).credit.botXp).toEqual([
        { playerId: ACCOUNT.id, xp: 30, left: 70 },
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
          await createMatchComponent({
            matchAccessor: accessor,
            matchPlayerIds: TEST_MATCH_PLAYER_IDS,
          }).transferPlayer({
            from: "guest_a",
            to: ACCOUNT,
            now: T0,
          });
          return listed;
        },
      },
      matchPlayerIds: TEST_MATCH_PLAYER_IDS,
    });
    await racing.recordFinished({ room: withMatch("m1", [ALICE, BOB]), outcome: WIN_A });

    expect(await racing.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 })).toEqual({
      moved: { matches: 0 },
    });
  });
});

describe("matchComponent and deleted players (CC-035)", () => {
  const ids = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];
  const erasing = () => {
    const queue = [...ids];
    return createMatchComponent({
      matchAccessor: createMatchAccessor({ matchDao: createInMemoryMatchDao() }),
      matchPlayerIds: TEST_MATCH_PLAYER_IDS,
      newUuid: () => queue.shift(),
    });
  };
  const ROCKY = { playerId: "bot_rocky_easy", displayName: "Rocky", connected: true };
  const finished = (matches, matchId, seats, outcome = WIN_A) =>
    matches.recordFinished({ room: room({ seats, game: { ...room().game, matchId } }), outcome });

  it("never judges a deleted player's stand-in", async () => {
    const matches = setup();
    const stand = { playerId: "deleted_x", displayName: "Deleted player", connected: false };
    const recorded = await finished(matches, "m-1", [room().seats[0], stand], {
      ...WIN_A,
      winners: ["deleted_x"],
    });

    const judged = await matches.judge(recorded);

    expect(judged.credit.notCounted.map((entry) => entry.playerId)).toEqual(["guest_a"]);
    expect(judged.credit).not.toHaveProperty("botXp");
  });

  it("keeps a shared match for the other player with a new anonymous id for each match, and deletes the rest", async () => {
    const matches = erasing();
    await finished(matches, "m-shared-1", room().seats);
    await finished(matches, "m-shared-2", room().seats);
    await finished(matches, "m-computer", [room().seats[0], ROCKY]);
    await finished(matches, "m-other", [room().seats[1], ROCKY]);

    const result = await matches.erasePlayer({ playerId: "guest_a" });

    expect(result).toEqual({ erased: { matchesAnonymised: 2, matchesDeleted: 1 } });
    expect((await matches.listForPlayer({ playerId: "guest_a", limit: 10 })).length).toBe(0);
    const first = await matches.getById("m-shared-1");
    const second = await matches.getById("m-shared-2");
    expect(first.players).toEqual([
      { playerId: `deleted_${ids[0]}`, displayName: "Deleted player" },
      { playerId: "guest_b", displayName: "Bob" },
    ]);
    expect(first.result.winners).toEqual([`deleted_${ids[0]}`]);
    expect(first.log[0].playerId).toBe(`deleted_${ids[0]}`);
    expect(second.players[0].playerId).toBe(`deleted_${ids[1]}`);
    expect((await matches.listForPlayer({ playerId: "guest_b", limit: 10 })).length).toBe(3);
    await expect(matches.getById("m-computer")).rejects.toThrow(NotFoundError);
    expect((await matches.getById("m-other")).players[0].playerId).toBe("guest_b");
  });

  it("changes nothing when erasing again", async () => {
    const matches = erasing();
    await finished(matches, "m-shared-1", room().seats);
    await matches.erasePlayer({ playerId: "guest_a" });

    expect(await matches.erasePlayer({ playerId: "guest_a" })).toEqual({
      erased: { matchesAnonymised: 0, matchesDeleted: 0 },
    });
  });

  it("exports the player's matches, naming them as you and the others by display name only", async () => {
    const matches = setup();
    await finished(matches, "m-shared-1", room().seats);
    await finished(matches, "m-computer", [room().seats[0], ROCKY], {
      ...WIN_A,
      winners: ["bot_rocky_easy"],
    });

    const exported = await matches.exportPlayer({ playerId: "guest_a" });

    expect(exported).toHaveLength(2);
    const shared = exported.find((m) => m.matchId === "m-shared-1");
    expect(shared).toEqual({
      matchId: "m-shared-1",
      gameId: "rps",
      options: { bestOf: 1 },
      startedAt: new Date(T0).toISOString(),
      endedAt: new Date(T0 + 9_000).toISOString(),
      players: [
        { player: "you", displayName: "Alice" },
        { player: "player-2", displayName: "Bob" },
      ],
      result: { result: "win", winners: ["you"], reason: "best-of-1" },
      log: [{ kind: "move", player: "you", move: { choice: "rock" }, at: new Date(T0 + 1).toISOString() }],
    });
    expect(JSON.stringify(exported)).not.toContain("guest_b");
    expect(JSON.stringify(exported)).not.toContain("guest_a");
    const computer = exported.find((m) => m.matchId === "m-computer");
    expect(computer.players[1]).toEqual({ player: "player-2", displayName: "Rocky", computer: true });
    expect(computer.result.winners).toEqual(["player-2"]);
  });

  it("exports nothing for a player without matches, and reads every page of a long history", async () => {
    const matches = setup();
    for (let i = 0; i < 102; i++) {
      await matches.recordFinished({
        room: room({ game: { ...room().game, matchId: `m-${i}` }, lastActivityAt: T0 + i }),
        outcome: WIN_A,
      });
    }

    expect(await matches.exportPlayer({ playerId: "guest_c" })).toEqual([]);
    expect(await matches.exportPlayer({ playerId: "guest_a" })).toHaveLength(102);
  });
});

describe("matchComponent export and erasure details (CC-035)", () => {
  it("exports every match even when many share one end time across a page edge", async () => {
    const matches = setup();
    for (let i = 0; i < 103; i++) {
      await matches.recordFinished({
        room: room({ game: { ...room().game, matchId: `m-${String(i).padStart(3, "0")}` } }),
        outcome: WIN_A,
      });
    }

    const exported = await matches.exportPlayer({ playerId: "guest_a" });

    expect(new Set(exported.map((m) => m.matchId)).size).toBe(103);
  });

  it("leaves no former guest id in the credit of an anonymised match", async () => {
    const accessor = createMatchAccessor({ matchDao: createInMemoryMatchDao() });
    const matches = createMatchComponent({
      matchAccessor: accessor,
      matchPlayerIds: TEST_MATCH_PLAYER_IDS,
      newUuid: () => "00000000-0000-4000-8000-0000000000b1",
    });
    await matches.recordFinished({ room: room(), outcome: WIN_A });
    await accessor.judgeOnce({
      matchId: room().game.matchId,
      credit: {
        notCounted: [{ playerId: "guest_a", reason: "hourly-limit", withdrawnFrom: "guest_old" }],
        botXp: [{ playerId: "guest_a", xp: 0, left: 0, withdrawnFrom: "guest_old", withdrawnXp: 30 }],
      },
    });

    await matches.erasePlayer({ playerId: "guest_a" });

    const stored = await matches.getById(room().game.matchId);
    expect(JSON.stringify(stored)).not.toContain("guest_old");
    expect(stored.credit.notCounted).toEqual([
      { playerId: "deleted_00000000-0000-4000-8000-0000000000b1", reason: "hourly-limit" },
    ]);
    expect(stored.credit.botXp[0]).not.toHaveProperty("withdrawnFrom");
  });
});

describe("matchComponent export leaves no other player's id anywhere (CC-035 review)", () => {
  it("labels the ids in every log entry, an accepted request and an idle loss included", async () => {
    const matches = setup();
    const log = [
      { kind: "agree", type: "draw", from: "guest_b", playerId: "guest_a", at: T0 + 1 },
      { kind: "idle", playerIds: ["guest_b"], at: T0 + 2 },
    ];
    await matches.recordFinished({ room: room({ game: { ...room().game, log } }), outcome: WIN_A });

    const [exported] = await matches.exportPlayer({ playerId: "guest_a" });

    expect(JSON.stringify(exported)).not.toContain("guest_b");
    expect(exported.log).toEqual([
      { kind: "agree", type: "draw", from: "player-2", player: "you", at: new Date(T0 + 1).toISOString() },
      { kind: "idle", playerIds: ["player-2"], at: new Date(T0 + 2).toISOString() },
    ]);
  });
});

describe("matchComponent anonymising beside a fair play verdict written meanwhile (CC-035 review)", () => {
  it("keeps the opponent's verdict when the match is judged between the read and the write", async () => {
    const accessor = createMatchAccessor({ matchDao: createInMemoryMatchDao() });
    let judgedMeanwhile = false;
    const racing = {
      ...accessor,
      async replaceRenamed(rename) {
        if (!judgedMeanwhile) {
          judgedMeanwhile = true;
          await accessor.judgeOnce({
            matchId: rename.match.matchId,
            credit: { notCounted: [{ playerId: "guest_b", reason: "hourly-limit" }] },
          });
        }
        return accessor.replaceRenamed(rename);
      },
    };
    const matches = createMatchComponent({
      matchAccessor: racing,
      matchPlayerIds: TEST_MATCH_PLAYER_IDS,
      newUuid: () => "00000000-0000-4000-8000-0000000000d1",
    });
    await matches.recordFinished({ room: room(), outcome: WIN_A });

    await matches.erasePlayer({ playerId: "guest_a" });

    const stored = await accessor.getById(room().game.matchId);
    expect(stored.credit).toEqual({ notCounted: [{ playerId: "guest_b", reason: "hourly-limit" }] });
    expect(stored.players[0].playerId).toBe("deleted_00000000-0000-4000-8000-0000000000d1");
  });
});
