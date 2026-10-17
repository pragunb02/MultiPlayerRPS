import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@classicade/shared";
import { createGamificationAccessor } from "../../data/gamificationAccessor.js";
import { createProgressAccessor } from "../../data/progressAccessor.js";
import {
  createInMemoryAchievementDao,
  createInMemoryQuestDao,
  createInMemoryStatsDao,
} from "../../testing/inMemoryGamificationDaos.js";
import { createInMemoryProgressDao } from "../../testing/inMemoryProgressDao.js";
import { createProgressionComponent, PROGRESSION_EVENTS } from "../progression/progressionComponent.js";
import { createGamificationComponent, GAMIFICATION_EVENTS, questKey } from "./gamificationComponent.js";

const DAY_MS = 86_400_000;
// 2026-10-16 12:00 UTC. guest_a's quests that day: play-3, win-1, rps-win-2 (pinned in questsFor.test.js).
const T = Date.UTC(2026, 9, 16, 12);
const ALICE = { playerId: "guest_a", displayName: "Alice" };
const BOB = { playerId: "guest_b", displayName: "Bob" };

let matchNumber = 0;
/** A recorded RPS match Alice wins, unless told otherwise. */
const match = ({
  at = T,
  gameId = "rps",
  winner = ALICE.playerId,
  players = [ALICE, BOB],
  ...rest
} = {}) => ({
  matchId: `m${++matchNumber}`,
  roomCode: "ROOM22",
  gameId,
  options: {},
  seed: 1,
  players,
  log: [],
  result: { result: "win", winners: [winner], reason: "best-of-1" },
  startedAt: at - 1_000,
  endedAt: at,
  ...rest,
});
const draw = (overrides) =>
  match({ ...overrides, result: { result: "draw", winners: [], reason: "agreement" } });

/** Renames a player in a recorded match, as the match participant of a transfer does (ADR-014). */
const renamed = (m, from, to) => ({
  ...m,
  players: m.players.map((p) => (p.playerId === from ? to : p)),
  result: { ...m.result, winners: m.result.winners.map((w) => (w === from ? to.playerId : w)) },
});

/** `staleUnlockReads`: the list of unlocks is always read as empty, as when another server unlocked meanwhile. */
function setup({ staleUnlockReads = false } = {}) {
  const published = [];
  const events = { emit: (event, payload) => published.push({ event, payload }) };
  // A fake match store: the recorded matches, newest first per player, like the real accessor.
  const recorded = [];
  const matchAccessor = {
    listForPlayer: async (playerId, { limit, before }) =>
      recorded
        .filter((m) => m.players.some((p) => p.playerId === playerId))
        .filter((m) => before === undefined || m.endedAt < before)
        .sort((a, b) => b.endedAt - a.endedAt)
        .slice(0, limit),
    listWithdrawn: async () => [],
  };
  const moveMatches = ({ from, to }) =>
    recorded.forEach((m, i) => {
      recorded[i] = renamed(m, from, to);
    });
  const progression = createProgressionComponent({
    progressAccessor: createProgressAccessor({ progressDao: createInMemoryProgressDao() }),
    matchAccessor,
    events,
  });
  const accessor = createGamificationAccessor({
    statsDao: createInMemoryStatsDao(),
    questDao: createInMemoryQuestDao(),
    achievementDao: createInMemoryAchievementDao(),
  });
  const gamification = createGamificationComponent({
    gamificationAccessor: staleUnlockReads ? { ...accessor, listUnlocks: async () => [] } : accessor,
    matchAccessor,
    progressionComponent: progression,
    events,
  });
  /** What the pipeline does: record, progression, then gamification. */
  async function finish(m, now = m.endedAt) {
    recorded.push(m);
    await progression.applyMatch(m);
    await gamification.applyMatch({ match: m, now });
    return m;
  }
  const pushed = (event, playerId) =>
    published.filter((p) => p.event === event && p.payload.playerId === playerId).map((p) => p.payload);
  return { gamification, progression, recorded, moveMatches, published, pushed, finish };
}

describe("gamificationComponent.applyMatch", () => {
  it("unlocks first match for both players and first win for the winner, and tells only them", async () => {
    const { finish, pushed } = setup();

    await finish(match());

    const ids = (playerId) =>
      pushed(GAMIFICATION_EVENTS.ACHIEVEMENTS_UNLOCKED, playerId).flatMap((p) =>
        p.achievements.map((a) => a.id),
      );
    expect(ids(ALICE.playerId)).toEqual(["first-match", "first-win"]);
    expect(ids(BOB.playerId)).toEqual(["first-match"]);
    expect(pushed(GAMIFICATION_EVENTS.ACHIEVEMENTS_UNLOCKED, ALICE.playerId)[0].achievements[0]).toEqual({
      id: "first-match",
      name: "First Move",
      description: "Finish your first match",
      icon: "flag",
      tier: "bronze",
      unlockedAt: T,
      progress: { current: 1, target: 1 },
    });
  });

  it("pushes streaks and today's quests after a counted match", async () => {
    const { finish, pushed } = setup();

    await finish(match());

    expect(pushed(GAMIFICATION_EVENTS.STREAKS_UPDATED, ALICE.playerId)).toEqual([
      {
        playerId: ALICE.playerId,
        streaks: {
          win: { current: 1, best: 1 },
          daily: { current: 1, best: 1, lastDay: "2026-10-16", playedToday: true, atRisk: false },
        },
      },
    ]);
    const [{ quests }] = pushed(GAMIFICATION_EVENTS.QUESTS_UPDATED, ALICE.playerId);
    expect(quests.items.map((q) => [q.id, q.progress, q.completedAt])).toEqual([
      ["play-3", 1, null],
      ["win-1", 1, T],
      ["rps-win-2", 1, null],
    ]);
  });

  it("awards a completed quest's bonus XP through progression, once, as a quest update", async () => {
    const { finish, progression, published } = setup();

    await finish(match());

    const questXp = published.filter(
      (p) => p.event === PROGRESSION_EVENTS.UPDATED && p.payload.source === "quest",
    );
    expect(questXp.map((p) => p.payload)).toEqual([
      expect.objectContaining({
        playerId: ALICE.playerId,
        displayName: "Alice",
        key: questKey("2026-10-16", "win-1"),
        matchId: "",
        xpGained: 20,
      }),
    ]);
    // 30 for the win + 20 for the quest; the quest is not a match played.
    expect(await progression.getProgress(ALICE.playerId)).toEqual(
      expect.objectContaining({ xp: 50, matchesPlayed: 1, level: 2 }),
    );
  });

  it("changes nothing and tells nobody when the same match is applied again", async () => {
    const { finish, gamification, progression, published } = setup();
    const m = await finish(match());
    const before = published.length;

    await gamification.applyMatch({ match: m, now: T });

    expect(published.slice(before)).toEqual([]);
    expect((await progression.getProgress(ALICE.playerId)).xp).toBe(50);
    expect((await gamification.getStreaks({ playerId: ALICE.playerId, now: T })).win.current).toBe(1);
  });

  it("completes all three quests, adds the daily sweep, and counts the quests", async () => {
    const { finish, progression, gamification } = setup();

    for (let i = 0; i < 3; i++) {
      await finish(match({ at: T + i }));
    }

    const quests = await gamification.getQuests({ playerId: ALICE.playerId, now: T + 10 });
    expect(quests.items.every((q) => q.completedAt !== null)).toBe(true);
    expect(quests.sweep).toEqual({ bonusXp: 30, completedAt: T + 2 });
    // 3 wins (90) + play-3 (20) + win-1 (20) + rps-win-2 (30) + sweep (30)
    expect((await progression.getProgress(ALICE.playerId)).xp).toBe(190);
    const questHunter = (await gamification.getAchievements({ playerId: ALICE.playerId })).find(
      (a) => a.id === "quests-10",
    );
    expect(questHunter.progress).toEqual({ current: 3, target: 10 });
  });

  it("does not push yesterday's quests when a match from yesterday is applied today", async () => {
    const { finish, pushed } = setup();

    await finish(match({ at: T }), T + DAY_MS);

    expect(pushed(GAMIFICATION_EVENTS.QUESTS_UPDATED, ALICE.playerId)).toEqual([]);
    expect(pushed(GAMIFICATION_EVENTS.STREAKS_UPDATED, ALICE.playerId)[0].streaks.daily).toEqual(
      expect.objectContaining({ current: 1, atRisk: true, playedToday: false }),
    );
  });

  it("counts a forfeit as a loss for the player who left and a win for the one who stayed", async () => {
    const { finish, gamification } = setup();
    await finish(match({ at: T }));

    await finish(
      match({
        at: T + 1,
        winner: BOB.playerId,
        result: { result: "win", winners: [BOB.playerId], reason: "forfeit" },
        log: [{ kind: "forfeit", playerId: ALICE.playerId, at: T + 1 }],
      }),
    );

    const alice = await gamification.getStreaks({ playerId: ALICE.playerId, now: T + 2 });
    const bob = await gamification.getStreaks({ playerId: BOB.playerId, now: T + 2 });
    expect(alice.win).toEqual({ current: 0, best: 1 });
    expect(bob.win).toEqual({ current: 1, best: 1 });
    const quests = await gamification.getQuests({ playerId: ALICE.playerId, now: T + 2 });
    expect(quests.items.find((q) => q.id === "play-3").progress).toBe(1);
  });

  it("gives a player a match doesn't count for no stats, streak, quest progress or achievement (CC-095)", async () => {
    const { finish, gamification, pushed } = setup();

    await finish(
      match({ credit: { notCounted: [{ playerId: ALICE.playerId, reason: "opponent-daily-limit" }] } }),
    );

    const alice = await gamification.getStreaks({ playerId: ALICE.playerId, now: T });
    expect(alice.win).toEqual({ current: 0, best: 0 });
    expect(alice.daily.playedToday).toBe(false);
    const quests = await gamification.getQuests({ playerId: ALICE.playerId, now: T });
    expect(quests.items.every((q) => q.progress === 0)).toBe(true);
    expect(
      (await gamification.getAchievements({ playerId: ALICE.playerId })).every((a) => a.unlockedAt === null),
    ).toBe(true);
    expect(pushed(GAMIFICATION_EVENTS.STREAKS_UPDATED, ALICE.playerId)).toEqual([]);
    expect(pushed(GAMIFICATION_EVENTS.STREAKS_UPDATED, BOB.playerId)).toHaveLength(1);
  });

  it("keeps the win streak through a draw and unlocks Hat Trick on the third win in a row", async () => {
    const { finish, gamification, pushed } = setup();

    await finish(match({ at: T }));
    await finish(draw({ at: T + 1 }));
    await finish(match({ at: T + 2 }));
    await finish(match({ at: T + 3 }));

    expect((await gamification.getStreaks({ playerId: ALICE.playerId, now: T + 4 })).win).toEqual({
      current: 3,
      best: 3,
    });
    const unlocked = pushed(GAMIFICATION_EVENTS.ACHIEVEMENTS_UNLOCKED, ALICE.playerId).flatMap((p) =>
      p.achievements.map((a) => a.id),
    );
    expect(unlocked.filter((id) => id === "streak-3")).toEqual(["streak-3"]);
  });

  it("never announces an unlock twice, even when its read of the unlocks is out of date", async () => {
    const { finish, pushed } = setup({ staleUnlockReads: true });

    await finish(match({ at: T }));
    await finish(match({ at: T + 1 }));

    const announced = pushed(GAMIFICATION_EVENTS.ACHIEVEMENTS_UNLOCKED, ALICE.playerId).flatMap((p) =>
      p.achievements.map((a) => a.id),
    );
    expect(announced).toEqual(["first-match", "first-win"]);
  });

  it("counts a checkmate win for Checkmate!", async () => {
    const { finish, gamification } = setup();

    await finish(
      match({ gameId: "chess", result: { result: "win", winners: [ALICE.playerId], reason: "checkmate" } }),
    );

    const checkmate = (await gamification.getAchievements({ playerId: ALICE.playerId })).find(
      (a) => a.id === "chess-checkmate",
    );
    expect(checkmate.unlockedAt).toBe(T);
  });
});

describe("gamificationComponent reads", () => {
  it("lists the whole catalog in order: unlocked with a time, locked with progress", async () => {
    const { finish, gamification } = setup();
    await finish(match());

    const achievements = await gamification.getAchievements({ playerId: ALICE.playerId });

    expect(achievements.map((a) => a.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(achievements.find((a) => a.id === "first-win")).toEqual(
      expect.objectContaining({ unlockedAt: T, progress: { current: 1, target: 1 } }),
    );
    expect(achievements.find((a) => a.id === "wins-10")).toEqual(
      expect.objectContaining({ unlockedAt: null, progress: { current: 1, target: 10 } }),
    );
  });

  it("gives a new player zero streaks", async () => {
    const { gamification } = setup();

    expect(await gamification.getStreaks({ playerId: "guest_new", now: T })).toEqual({
      win: { current: 0, best: 0 },
      daily: { current: 0, best: 0, lastDay: "", playedToday: false, atRisk: false },
    });
  });

  it("shows today's quests with the reset time, stable across reads, and a new set after UTC midnight", async () => {
    const { gamification } = setup();
    const lastMoment = Date.UTC(2026, 9, 16, 23, 59, 59, 999);

    const first = await gamification.getQuests({ playerId: ALICE.playerId, now: T });
    const again = await gamification.getQuests({ playerId: ALICE.playerId, now: lastMoment });
    const tomorrow = await gamification.getQuests({ playerId: ALICE.playerId, now: lastMoment + 1 });

    expect(first).toEqual({
      day: "2026-10-16",
      resetsAt: Date.UTC(2026, 9, 17),
      items: [
        expect.objectContaining({
          id: "play-3",
          gameId: null,
          target: 3,
          progress: 0,
          bonusXp: 20,
          completedAt: null,
        }),
        expect.objectContaining({ id: "win-1", name: "First blood", description: "Get a win" }),
        expect.objectContaining({ id: "rps-win-2", gameId: "rps" }),
      ],
      sweep: { bonusXp: 30, completedAt: null },
    });
    expect(again.items).toEqual(first.items);
    expect(tomorrow.day).toBe("2026-10-17");
    expect(tomorrow.items.map((q) => q.id)).toEqual(["play-5", "win-1", "rps-play-3"]);
  });
});

describe("gamificationComponent.transferPlayer", () => {
  const ACCOUNT = { id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
  const RIYA = { playerId: ACCOUNT.id, displayName: "Riya" };

  it("moves unlocks, rebuilds streaks from the moved matches, and merges completed quests", async () => {
    const { finish, gamification, moveMatches } = setup();
    await finish(match({ at: T - DAY_MS, players: [RIYA, BOB], winner: BOB.playerId }));
    for (let i = 0; i < 3; i++) {
      await finish(match({ at: T + i }));
    }
    moveMatches({ from: ALICE.playerId, to: RIYA });

    const { moved } = await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 10 });

    expect(moved).toEqual({ achievements: 3, stats: 1, questDays: 1 });
    expect(await gamification.getStreaks({ playerId: ACCOUNT.id, now: T + 10 })).toEqual({
      win: { current: 3, best: 3 },
      daily: { current: 2, best: 2, lastDay: "2026-10-16", playedToday: true, atRisk: false },
    });
    const achievements = await gamification.getAchievements({ playerId: ACCOUNT.id });
    const unlocked = achievements.filter((a) => a.unlockedAt !== null).map((a) => [a.id, a.unlockedAt]);
    // first-match keeps the account's own, earlier unlock time.
    expect(unlocked).toEqual([
      ["first-match", T - DAY_MS],
      ["first-win", T],
      ["streak-3", T + 2],
    ]);
    expect(achievements.find((a) => a.id === "quests-10").progress.current).toBe(3);
  });

  it("rebuilds the account's streaks from the games that count for it only (CC-095)", async () => {
    const { finish, gamification, moveMatches, recorded } = setup();
    await finish(match({ at: T }));
    await finish(match({ at: T + 1 }));
    moveMatches({ from: ALICE.playerId, to: RIYA });
    // The second game stopped counting when it moved: the account had reached a limit that day.
    recorded[1] = {
      ...recorded[1],
      credit: {
        notCounted: [{ playerId: RIYA.playerId, reason: "hourly-limit", withdrawnFrom: ALICE.playerId }],
      },
    };

    await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 10 });

    expect((await gamification.getStreaks({ playerId: ACCOUNT.id, now: T + 10 })).win).toEqual({
      current: 1,
      best: 1,
    });
  });

  it("leaves nothing behind for the guest", async () => {
    const { finish, gamification, moveMatches } = setup();
    await finish(match());
    moveMatches({ from: ALICE.playerId, to: RIYA });

    await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 10 });

    expect((await gamification.getStreaks({ playerId: ALICE.playerId, now: T })).win.best).toBe(0);
    expect(
      (await gamification.getAchievements({ playerId: ALICE.playerId })).every((a) => a.unlockedAt === null),
    ).toBe(true);
    expect(
      (await gamification.getQuests({ playerId: ALICE.playerId, now: T })).items.every(
        (q) => q.progress === 0,
      ),
    ).toBe(true);
  });

  it("is idempotent: transferring again changes nothing, and never counts the quests twice", async () => {
    const { finish, gamification, moveMatches } = setup();
    for (let i = 0; i < 3; i++) {
      await finish(match({ at: T + i }));
    }
    moveMatches({ from: ALICE.playerId, to: RIYA });

    await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 10 });
    const again = await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 11 });

    expect(again.moved).toEqual({ achievements: 0, stats: 0, questDays: 0 });
    const questHunter = (await gamification.getAchievements({ playerId: ACCOUNT.id })).find(
      (a) => a.id === "quests-10",
    );
    expect(questHunter.progress.current).toBe(3);
  });

  it("unlocks what guest and account earned only together, and tells the account", async () => {
    const { finish, gamification, moveMatches, pushed } = setup();
    await finish(match({ at: T - 2 * DAY_MS, players: [RIYA, BOB], winner: BOB.playerId }));
    await finish(match({ at: T - DAY_MS, players: [RIYA, BOB], winner: BOB.playerId }));
    await finish(match({ at: T }));
    moveMatches({ from: ALICE.playerId, to: RIYA });

    await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 10 });

    const last = pushed(GAMIFICATION_EVENTS.ACHIEVEMENTS_UNLOCKED, ACCOUNT.id).at(-1);
    expect(last.achievements.map((a) => [a.id, a.unlockedAt])).toEqual([["daily-3", T + 10]]);
  });

  it("does not count a match again that the rebuild already counted (a game that ended during the sign-in)", async () => {
    const { finish, gamification, moveMatches, recorded } = setup();
    await finish(match({ at: T }));
    moveMatches({ from: ALICE.playerId, to: RIYA });
    await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 10 });

    await gamification.applyMatch({ match: recorded[0], now: T + 11 });

    expect((await gamification.getStreaks({ playerId: ACCOUNT.id, now: T + 11 })).win).toEqual({
      current: 1,
      best: 1,
    });
  });

  it("reads the whole history, page by page", async () => {
    const { gamification, recorded } = setup();
    for (let i = 0; i < 150; i++) {
      recorded.push(match({ at: T + i, players: [RIYA, BOB], winner: RIYA.playerId }));
    }

    await gamification.transferPlayer({ from: ALICE.playerId, to: ACCOUNT, now: T + 500 });

    expect((await gamification.getStreaks({ playerId: ACCOUNT.id, now: T + 500 })).win.best).toBe(150);
  });
});

describe("createGamificationComponent", () => {
  it("checks its dependencies at construction", () => {
    const deps = {
      gamificationAccessor: {},
      matchAccessor: { listForPlayer() {} },
      progressionComponent: { awardBonus() {}, getProgress() {} },
      events: { emit() {} },
    };

    expect(() => createGamificationComponent(deps)).not.toThrow();
    for (const missing of Object.keys(deps)) {
      expect(() => createGamificationComponent({ ...deps, [missing]: undefined })).toThrow(TypeError);
    }
  });
});
