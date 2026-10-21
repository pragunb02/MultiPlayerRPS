import { describe, expect, it } from "vitest";
import { createGamificationAccessor } from "../../data/gamificationAccessor.js";
import { createProgressAccessor } from "../../data/progressAccessor.js";
import { createTimeZoneAccessor } from "../../data/timeZoneAccessor.js";
import { flagPaths } from "../../testing/flagPaths.js";
import {
  createInMemoryAchievementDao,
  createInMemoryQuestDao,
  createInMemoryStatsDao,
} from "../../testing/inMemoryGamificationDaos.js";
import { createInMemoryProgressDao } from "../../testing/inMemoryProgressDao.js";
import { createInMemoryTimeZoneDao } from "../../testing/inMemoryTimeZoneDao.js";
import { createPlayerDaysComponent } from "../playerDays/playerDaysComponent.js";
import { createProgressionComponent } from "../progression/progressionComponent.js";
import { createGamificationComponent, GAMIFICATION_EVENTS } from "./gamificationComponent.js";

// Streaks and quests on the player's own days (CC-146) with freezes (CC-145). The clock is injected: every moment
// is written out and nothing reads the real clock (CC-325).
const at = (iso) => Date.parse(iso);
/** Noon in India on a day. */
const indiaNoon = (day) => at(`${day}T06:30:00.000Z`);
const ALICE = { playerId: "guest_a", displayName: "Alice" };
const BOB = { playerId: "guest_b", displayName: "Bob" };
const ACCOUNT = { playerId: "user_x", displayName: "Xena" };

let matchNumber = 0;
const match = ({ endedAt, players = [ALICE, BOB], winner = players[0].playerId }) => ({
  matchId: `local-${++matchNumber}`,
  roomCode: "ROOM22",
  gameId: "rps",
  options: {},
  seed: 1,
  players,
  log: [],
  result: { result: "win", winners: [winner], reason: "best-of-1" },
  startedAt: endedAt - 1_000,
  endedAt,
});

function setUp(on = ["local_days", "streak_freezes"]) {
  const published = [];
  const successes = [];
  const events = { emit: (event, payload) => published.push({ event, payload }) };
  const flags = {
    isOn: async (name) => on.includes(name),
    recordSuccess: async (name, player) => successes.push([name, player.id]),
  };
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
  const progression = createProgressionComponent({
    progressAccessor: createProgressAccessor({ progressDao: createInMemoryProgressDao() }),
    matchAccessor,
    events,
  });
  const days = createPlayerDaysComponent({
    timeZoneAccessor: createTimeZoneAccessor({ timeZoneDao: createInMemoryTimeZoneDao() }),
    flags,
  });
  const gamification = createGamificationComponent({
    gamificationAccessor: createGamificationAccessor({
      statsDao: createInMemoryStatsDao(),
      questDao: createInMemoryQuestDao(),
      achievementDao: createInMemoryAchievementDao(),
    }),
    matchAccessor,
    progressionComponent: progression,
    events,
    days,
  });
  async function finish(m) {
    recorded.push(m);
    await progression.applyMatch(m);
    await gamification.applyMatch({ match: m, now: m.endedAt });
  }
  const moveMatches = (from, to) =>
    recorded.forEach((m, i) => {
      recorded[i] = {
        ...m,
        players: m.players.map((p) => (p.playerId === from ? to : p)),
        result: { ...m.result, winners: m.result.winners.map((w) => (w === from ? to.playerId : w)) },
      };
    });
  return { gamification, days, finish, published, successes, moveMatches };
}

describe("gamification on local days (CC-146)", () => {
  it("counts streaks and quests on the player's own day", async () => {
    const { gamification, days, finish } = setUp(["local_days"]);
    await days.setTimeZone({ playerId: ALICE.playerId, zone: "America/New_York", now: at("2026-10-01T12:00Z") });
    // 23:30 on 21 October in New York, already the 22nd in UTC and in India.
    const late = at("2026-10-22T03:30:00Z");
    await finish(match({ endedAt: late }));

    const streaks = await gamification.getStreaks({ playerId: ALICE.playerId, now: late });
    expect(streaks.daily).toMatchObject({
      current: 1,
      lastDay: "2026-10-21",
      playedToday: true,
      resetsAt: at("2026-10-22T04:00:00Z"),
    });
    const quests = await gamification.getQuests({ playerId: ALICE.playerId, now: late });
    expect(quests).toMatchObject({ day: "2026-10-21", resetsAt: at("2026-10-22T04:00:00Z") });
    expect(quests.items.some((item) => item.progress > 0)).toBe(true);
    // Half an hour later it is the 22nd in New York: a fresh day of quests, and the streak is at risk until played.
    const next = at("2026-10-22T04:00:00Z");
    expect((await gamification.getQuests({ playerId: ALICE.playerId, now: next })).day).toBe("2026-10-22");
    expect((await gamification.getStreaks({ playerId: ALICE.playerId, now: next })).daily.atRisk).toBe(true);
  });

  it("keeps UTC days without the flag, as before", async () => {
    const { gamification, finish } = setUp([]);
    const late = at("2026-10-22T03:30:00Z");
    await finish(match({ endedAt: late }));
    const streaks = await gamification.getStreaks({ playerId: ALICE.playerId, now: late });
    expect(streaks.daily).toEqual({ current: 1, best: 1, lastDay: "2026-10-22", playedToday: true, atRisk: false });
    expect(await gamification.getQuests({ playerId: ALICE.playerId, now: late })).toMatchObject({
      day: "2026-10-22",
      resetsAt: at("2026-10-23T00:00:00Z"),
    });
  });

  it("a zone change west does not repair a missed day", async () => {
    const { gamification, days, finish } = setUp(["local_days"]);
    await finish(match({ endedAt: indiaNoon("2026-10-19") }));
    await finish(match({ endedAt: indiaNoon("2026-10-20") }));
    // 01:00 on the 22nd in India: the whole of the 21st was missed. In New York it is still 15:30 on the 21st.
    const now = at("2026-10-21T19:30:00Z");
    await days.setTimeZone({ playerId: ALICE.playerId, zone: "America/New_York", now });
    await finish(match({ endedAt: now }));
    expect((await gamification.getStreaks({ playerId: ALICE.playerId, now })).daily).toMatchObject({
      current: 1,
      best: 2,
      lastDay: "2026-10-22",
    });
  });
});

describe("streak freezes (CC-145)", () => {
  flagPaths("streak_freezes", (on) => {
    it(on ? "earns, shows and spends freezes" : "has no freezes and breaks a streak on a missed day", async () => {
      const { gamification, finish, successes } = setUp(on ? ["local_days", "streak_freezes"] : ["local_days"]);
      await finish(match({ endedAt: indiaNoon("2026-10-19") }));
      await finish(match({ endedAt: indiaNoon("2026-10-20") }));
      const read = await gamification.getStreaks({ playerId: ALICE.playerId, now: indiaNoon("2026-10-22") });
      await finish(match({ endedAt: indiaNoon("2026-10-22") }));
      const after = await gamification.getStreaks({ playerId: ALICE.playerId, now: indiaNoon("2026-10-22") });
      if (on) {
        expect(read.daily).toMatchObject({ current: 2, freezes: { held: 0, covering: 1, earnBackLeft: 2 } });
        expect(after.daily).toMatchObject({ current: 3, freezes: { held: 0, covering: 0, earnBackLeft: 1 } });
        // Both players missed the 21st, so each counts once.
        expect(successes).toEqual([
          ["streak_freezes", ALICE.playerId],
          ["streak_freezes", BOB.playerId],
        ]);
      } else {
        expect(read.daily).toMatchObject({ current: 0 });
        expect(read.daily).not.toHaveProperty("freezes");
        expect(after.daily).toMatchObject({ current: 1, best: 2 });
        expect(successes).toEqual([]);
      }
    });
  });

  it("covers a missed New York day across the summer time change", async () => {
    const { gamification, days, finish, published } = setUp();
    await days.setTimeZone({ playerId: ALICE.playerId, zone: "America/New_York", now: at("2026-10-01T12:00Z") });
    await finish(match({ endedAt: at("2026-10-30T16:00:00Z") })); // Friday 30th, noon in New York: a freeze
    await finish(match({ endedAt: at("2026-10-31T16:00:00Z") })); // Saturday 31st
    // Sunday 1 November lasts 25 hours in New York. 23:30 that evening is 04:30 UTC on the 2nd: still Sunday.
    const sundayNight = at("2026-11-02T04:30:00Z");
    expect(
      (await gamification.getStreaks({ playerId: ALICE.playerId, now: sundayNight })).daily,
    ).toMatchObject({ current: 2, atRisk: false, freezes: { held: 1, covering: 0 } });
    // Monday 2nd, 00:30 in New York (05:30 UTC): Sunday was missed, and the freeze covers it.
    await finish(match({ endedAt: at("2026-11-02T05:30:00Z") }));
    const monday = await gamification.getStreaks({ playerId: ALICE.playerId, now: at("2026-11-02T05:30:00Z") });
    // The freeze was spent, and Monday starts a new week, which earns one again.
    expect(monday.daily).toMatchObject({ current: 3, lastDay: "2026-11-02", freezes: { held: 1, earnBackLeft: 1 } });
    const pushed = published.filter((p) => p.event === GAMIFICATION_EVENTS.STREAKS_UPDATED).at(-1);
    expect(pushed.payload.streaks.daily).toMatchObject({ current: 3, freezes: { held: 1 } });
  });

  it("earns the freeze back with a second match that day", async () => {
    const { gamification, finish } = setUp();
    await finish(match({ endedAt: indiaNoon("2026-10-19") }));
    await finish(match({ endedAt: indiaNoon("2026-10-20") }));
    await finish(match({ endedAt: indiaNoon("2026-10-22") }));
    await finish(match({ endedAt: indiaNoon("2026-10-22") + 60_000 }));
    const view = await gamification.getStreaks({ playerId: ALICE.playerId, now: indiaNoon("2026-10-22") + 60_000 });
    expect(view.daily).toMatchObject({ current: 3, freezes: { held: 1, earnBackLeft: 0 } });
  });

  it("keeps a protected streak and the larger holding when a guest signs in", async () => {
    const { gamification, finish, moveMatches } = setUp();
    const versus = (player, day) => match({ endedAt: indiaNoon(day), players: [player, BOB] });
    await finish(versus(ACCOUNT, "2026-10-19"));
    await finish(versus(ACCOUNT, "2026-10-20"));
    await finish(versus(ACCOUNT, "2026-10-22")); // the 21st covered: 0 freezes left
    await finish(versus(ALICE, "2026-10-22")); // the guest earns one
    moveMatches(ALICE.playerId, ACCOUNT);
    await gamification.transferPlayer({ from: ALICE.playerId, to: { id: ACCOUNT.playerId }, now: indiaNoon("2026-10-22") });
    const view = await gamification.getStreaks({ playerId: ACCOUNT.playerId, now: indiaNoon("2026-10-22") });
    expect(view.daily).toMatchObject({ current: 3, best: 3, freezes: { held: 1 } });
  });

  it("exports the freezes with the stats", async () => {
    const { gamification, finish } = setUp();
    await finish(match({ endedAt: indiaNoon("2026-10-19") }));
    const exported = await gamification.exportPlayer({ playerId: ALICE.playerId });
    expect(exported.stats.dailyStreak).toMatchObject({ freezes: 1, freezeWeek: "2026-10-19", frozenDays: [] });
    expect((await gamification.erasePlayer({ playerId: ALICE.playerId })).erased.stats).toBe(1);
  });
});
