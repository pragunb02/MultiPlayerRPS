import { describe, expect, it } from "vitest";
import { MAX_LEVEL, NOT_COUNTED_REASONS } from "@classicade/shared";
import { createMatchAccessor } from "../../data/matchAccessor.js";
import { createProgressAccessor } from "../../data/progressAccessor.js";
import { createInMemoryMatchDao } from "../../testing/inMemoryMatchDao.js";
import { createInMemoryProgressDao } from "../../testing/inMemoryProgressDao.js";
import {
  createProgressionComponent,
  PROGRESSION_EVENTS,
  resultFor,
  XP_SOURCES,
} from "./progressionComponent.js";

const T0 = 1_760_000_000_000;
const PLAYERS = [
  { playerId: "guest_a", displayName: "Alice" },
  { playerId: "guest_b", displayName: "Bob" },
];
const match = (overrides = {}) => ({
  matchId: "m1",
  gameId: "rps",
  players: PLAYERS,
  log: [],
  result: { result: "win", winners: ["guest_a"], reason: "best-of-1" },
  startedAt: T0,
  endedAt: T0 + 1,
  ...overrides,
});
const forfeitByB = () =>
  match({
    result: { result: "win", winners: ["guest_a"], reason: "forfeit" },
    log: [{ kind: "forfeit", playerId: "guest_b", at: T0 + 1 }],
  });

function setup() {
  const published = [];
  const progressDao = createInMemoryProgressDao();
  const matchDao = createInMemoryMatchDao();
  const matchAccessor = createMatchAccessor({ matchDao });
  const progression = createProgressionComponent({
    progressAccessor: createProgressAccessor({ progressDao }),
    matchAccessor,
    events: { emit: (event, payload) => published.push({ event, payload }) },
  });
  return { progression, published, progressDao, matchAccessor };
}

describe("resultFor", () => {
  it.each([
    [match(), "guest_a", "win"],
    [match(), "guest_b", "loss"],
    [match({ result: { result: "draw", winners: [], reason: "agreement" } }), "guest_b", "draw"],
    [forfeitByB(), "guest_b", "forfeit"],
    [forfeitByB(), "guest_a", "win"],
  ])("%#: %s → %s", (m, playerId, expected) => {
    expect(resultFor(m, playerId)).toBe(expected);
  });
});

describe("progressionComponent", () => {
  it("awards XP per result and counts the match (win 30, loss 10)", async () => {
    const { progression } = setup();

    await progression.applyMatch(match());

    expect(await progression.getProgress("guest_a")).toEqual(
      expect.objectContaining({
        xp: 30,
        matchesPlayed: 1,
        wins: 1,
        level: 1,
        xpIntoLevel: 30,
        xpForNextLevel: 50,
      }),
    );
    expect(await progression.getProgress("guest_b")).toEqual(expect.objectContaining({ xp: 10, losses: 1 }));
  });

  it("gives a player who left nothing, but counts the loss", async () => {
    const { progression } = setup();

    await progression.applyMatch(forfeitByB());

    expect(await progression.getProgress("guest_b")).toEqual(
      expect.objectContaining({ xp: 0, matchesPlayed: 1, losses: 1 }),
    );
  });

  it("publishes one update per player, flagging a level-up (BUG-08)", async () => {
    const { progression, published } = setup();
    await progression.applyMatch(match({ matchId: "m0" })); // Alice: 30 XP

    await progression.applyMatch(match({ matchId: "m1" })); // Alice: 60 XP → level 2

    const aliceUpdate = published.filter((p) => p.payload.playerId === "guest_a").at(-1);
    expect(aliceUpdate).toEqual({
      event: PROGRESSION_EVENTS.UPDATED,
      payload: expect.objectContaining({ matchId: "m1", result: "win", xpGained: 30, leveledUp: true }),
    });
    expect(aliceUpdate.payload.progress).toEqual(
      expect.objectContaining({ xp: 60, level: 2, xpIntoLevel: 10, xpForNextLevel: 100 }),
    );
  });

  it("awards a match only once, even if it is applied again (BUG-02: no per-round or duplicate XP)", async () => {
    const { progression, published } = setup();
    await progression.applyMatch(match());

    const second = await progression.applyMatch(match());

    expect(second).toEqual([]);
    expect(published).toHaveLength(2);
    expect((await progression.getProgress("guest_a")).xp).toBe(30);
  });

  it("says who earned it and that it came from a match, keyed by the match id", async () => {
    const { progression, published } = setup();

    await progression.applyMatch(match());

    expect(published[1].payload).toEqual(
      expect.objectContaining({
        playerId: "guest_b",
        displayName: "Bob",
        source: XP_SOURCES.MATCH,
        key: "m1",
        matchId: "m1",
        result: "loss",
      }),
    );
  });

  it("awards bonus XP once per key, without counting a match, and publishes it as quest XP", async () => {
    const { progression, published } = setup();
    const bonus = {
      playerId: "guest_a",
      displayName: "Alice",
      key: "quest:2026-10-16:win-1",
      xp: 60,
      at: T0,
    };

    const first = await progression.awardBonus(bonus);
    const again = await progression.awardBonus(bonus);

    expect(first).toEqual({ applied: true });
    expect(again).toEqual({ applied: false });
    expect(published).toEqual([
      {
        event: PROGRESSION_EVENTS.UPDATED,
        payload: expect.objectContaining({
          playerId: "guest_a",
          displayName: "Alice",
          source: XP_SOURCES.QUEST,
          key: "quest:2026-10-16:win-1",
          matchId: "",
          xpGained: 60,
          leveledUp: true,
          progress: expect.objectContaining({ xp: 60, level: 2, matchesPlayed: 0 }),
          counted: true,
          notCountedReason: "",
          ranked: true,
        }),
      },
    ]);
  });

  it("keeps a bonus that a game against a computer character earned off the leaderboards (ADR-025)", async () => {
    const { progression, published, progressDao } = setup();

    await progression.awardBonus({
      playerId: "guest_a",
      displayName: "Alice",
      key: "quest:2026-10-16:win-1",
      xp: 60,
      at: T0,
      unranked: true,
    });

    expect(published[0].payload).toEqual(expect.objectContaining({ xpGained: 60, ranked: false }));
    expect(await progressDao.getByPlayer("guest_a")).toEqual(
      expect.objectContaining({ xp: 60, unrankedXp: 60 }),
    );
    expect(published[0].payload.progress).not.toHaveProperty("unrankedXp");
  });

  it("does not flag a level-up for bonus XP that stays within the level", async () => {
    const { progression, published } = setup();

    await progression.awardBonus({
      playerId: "guest_a",
      displayName: "Alice",
      key: "quest:d:x",
      xp: 20,
      at: T0,
    });

    expect(published[0].payload.leveledUp).toBe(false);
  });

  it("says a match that counted counted", async () => {
    const { progression, published } = setup();

    await progression.applyMatch(match());

    expect(published.map((p) => [p.payload.counted, p.payload.notCountedReason])).toEqual([
      [true, ""],
      [true, ""],
    ]);
  });

  it("gives a player a match doesn't count for nothing at all, and tells them why, once (CC-095)", async () => {
    const { progression, published } = setup();
    const judged = match({
      credit: { notCounted: [{ playerId: "guest_a", reason: NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT }] },
    });

    const updates = await progression.applyMatch(judged);
    await progression.applyMatch(judged);

    expect(updates[0]).toEqual(
      expect.objectContaining({
        playerId: "guest_a",
        result: "win",
        xpGained: 0,
        leveledUp: false,
        counted: false,
        notCountedReason: NOT_COUNTED_REASONS.OPPONENT_DAILY_LIMIT,
      }),
    );
    expect(updates[1]).toEqual(expect.objectContaining({ playerId: "guest_b", xpGained: 10, counted: true }));
    expect(await progression.getProgress("guest_a")).toEqual(
      expect.objectContaining({ xp: 0, matchesPlayed: 0, wins: 0, losses: 0 }),
    );
    expect(published).toHaveLength(2);
  });

  describe("games against a computer character (ADR-025)", () => {
    const vsRocky = (botXp) =>
      match({
        players: [PLAYERS[0], { playerId: "bot_rocky_easy", displayName: "Rocky" }],
        credit: { notCounted: [], botXp: [{ playerId: "guest_a", ...botXp }] },
      });

    it("gives the computer character no progress, and the person the XP their verdict allows", async () => {
      const { progression, published } = setup();

      const updates = await progression.applyMatch(vsRocky({ xp: 10, left: 0 }));

      expect(updates.map((u) => u.playerId)).toEqual(["guest_a"]);
      expect(updates[0]).toEqual(
        expect.objectContaining({ xpGained: 10, counted: true, botXpLeft: 0, result: "win" }),
      );
      expect(published).toHaveLength(1);
      expect(await progression.getProgress("guest_a")).toEqual(
        expect.objectContaining({ xp: 10, matchesPlayed: 1, wins: 1 }),
      );
    });

    it("marks the XP from a game against a computer character as unranked, and a game between people not", async () => {
      const { progression, progressDao } = setup();

      await progression.applyMatch(vsRocky({ xp: 30, left: 70 }));
      await progression.applyMatch(match({ matchId: "m-people" }));

      expect(await progressDao.getByPlayer("guest_a")).toEqual(
        expect.objectContaining({ xp: 60, unrankedXp: 30 }),
      );
      expect(await progression.getProgress("guest_a")).not.toHaveProperty("unrankedXp");
    });

    it("still counts the game when the day's XP from computer games is used up", async () => {
      const { progression } = setup();

      const [update] = await progression.applyMatch(vsRocky({ xp: 0, left: 0 }));

      expect(update).toEqual(expect.objectContaining({ xpGained: 0, counted: true, botXpLeft: 0 }));
      expect(await progression.getProgress("guest_a")).toEqual(
        expect.objectContaining({ xp: 0, matchesPlayed: 1, wins: 1 }),
      );
    });

    it("says nothing about the computer limit after a game between people", async () => {
      const { progression } = setup();

      const updates = await progression.applyMatch(match());

      expect(updates[0]).not.toHaveProperty("botXpLeft");
    });
  });

  it("refuses to start without a way to read withdrawn matches", () => {
    expect(() =>
      createProgressionComponent({
        progressAccessor: createProgressAccessor({ progressDao: createInMemoryProgressDao() }),
        matchAccessor: {},
        events: { emit: () => {} },
      }),
    ).toThrow(/matchAccessor.listWithdrawn/);
  });

  it("starts new players at level 1 with zero XP", async () => {
    expect(await setup().progression.getProgress("guest_new")).toEqual(
      expect.objectContaining({ xp: 0, level: 1, xpIntoLevel: 0, xpForNextLevel: 50 }),
    );
  });

  it("caps at the top level: no next level to aim for", async () => {
    const { progression, progressDao } = setup();
    await progressDao.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m-big",
      inc: { xp: 10 ** 9 },
      at: new Date(T0),
    });

    expect(await progression.getProgress("guest_a")).toEqual(
      expect.objectContaining({ level: MAX_LEVEL, xpForNextLevel: 0 }),
    );
  });
});

describe("progressionComponent: a guest's progress moving to their account (CC-032)", () => {
  const ACCOUNT = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });

  it("adds the guest's XP to the account once; the level follows from the XP", async () => {
    const { progression, progressDao } = setup();
    await progressDao.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m0",
      inc: { xp: 60, matchesPlayed: 2, wins: 2 },
      at: new Date(T0),
    });

    const first = await progression.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 + 5 });
    const again = await progression.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 + 6 });

    expect(first.moved).toEqual(expect.objectContaining({ xp: 60, matchesPlayed: 2 }));
    expect(again.moved).toEqual(expect.objectContaining({ xp: 0, matchesPlayed: 0 }));
    expect(await progression.getProgress(ACCOUNT.id)).toEqual(
      expect.objectContaining({ xp: 60, matchesPlayed: 2, wins: 2, level: 2 }),
    );
  });

  it("leaves out the games that stopped counting when they moved to the account (CC-095)", async () => {
    const { progression, progressDao, matchAccessor } = setup();
    await progressDao.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m0",
      inc: { xp: 70, matchesPlayed: 3, wins: 2, losses: 1 },
      at: new Date(T0),
    });
    const moved = (matchId, winners) =>
      match({
        matchId,
        players: [{ playerId: ACCOUNT.id, displayName: "Riya" }, PLAYERS[1]],
        result: { result: "win", winners, reason: "best-of-1" },
      });
    const withdrawn = {
      notCounted: [{ playerId: ACCOUNT.id, reason: "opponent-daily-limit", withdrawnFrom: "guest_a" }],
    };
    await matchAccessor.record(moved("m-won", [ACCOUNT.id]));
    await matchAccessor.record(moved("m-lost", ["guest_b"]));
    await matchAccessor.judgeOnce({ matchId: "m-won", credit: withdrawn });
    await matchAccessor.judgeOnce({ matchId: "m-lost", credit: withdrawn });

    const { moved: carried } = await progression.transferPlayer({
      from: "guest_a",
      to: ACCOUNT,
      now: T0 + 5,
    });

    expect(carried).toEqual({ xp: 30, unrankedXp: 0, matchesPlayed: 1, wins: 1, losses: 0, draws: 0 });
    expect(await progression.getProgress(ACCOUNT.id)).toEqual(expect.objectContaining({ xp: 30, wins: 1 }));
  });

  it("takes back only the XP a withdrawn game against a computer character really gave", async () => {
    const { progression, progressDao, matchAccessor } = setup();
    await progressDao.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m0",
      inc: { xp: 50, matchesPlayed: 2, wins: 2 },
      at: new Date(T0),
    });
    await matchAccessor.record(
      match({
        matchId: "m-vs-rocky",
        players: [
          { playerId: ACCOUNT.id, displayName: "Riya" },
          { playerId: "bot_rocky_easy", displayName: "Rocky" },
        ],
        result: { result: "win", winners: [ACCOUNT.id], reason: "best-of-1" },
      }),
    );
    await matchAccessor.judgeOnce({
      matchId: "m-vs-rocky",
      credit: {
        notCounted: [{ playerId: ACCOUNT.id, reason: "opponent-daily-limit", withdrawnFrom: "guest_a" }],
        botXp: [{ playerId: ACCOUNT.id, xp: 20, left: 0 }],
      },
    });

    const { moved: carried } = await progression.transferPlayer({
      from: "guest_a",
      to: ACCOUNT,
      now: T0 + 5,
    });

    expect(carried).toEqual(expect.objectContaining({ xp: 30, matchesPlayed: 1, wins: 1 }));
  });

  it("takes back the XP of a guest's computer game that went past the account's own daily limit (ADR-025)", async () => {
    const { progression, progressDao, matchAccessor } = setup();
    await progressDao.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m0",
      inc: { xp: 30, unrankedXp: 30, matchesPlayed: 1, wins: 1 },
      at: new Date(T0),
    });
    await matchAccessor.record(
      match({
        matchId: "m-vs-rocky",
        players: [
          { playerId: ACCOUNT.id, displayName: "Riya" },
          { playerId: "bot_rocky_easy", displayName: "Rocky" },
        ],
        result: { result: "win", winners: [ACCOUNT.id], reason: "best-of-1" },
      }),
    );
    await matchAccessor.judgeOnce({
      matchId: "m-vs-rocky",
      credit: {
        notCounted: [],
        botXp: [{ playerId: ACCOUNT.id, xp: 10, left: 0, withdrawnFrom: "guest_a", withdrawnXp: 20 }],
      },
    });

    const { moved: carried } = await progression.transferPlayer({
      from: "guest_a",
      to: ACCOUNT,
      now: T0 + 5,
    });

    expect(carried).toEqual(expect.objectContaining({ xp: 10, unrankedXp: 10, matchesPlayed: 1, wins: 1 }));
  });

  it("awards a match that finished during the move to the account, once", async () => {
    const { progression, published } = setup();
    await progression.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    await progression.applyMatch(match());
    await progression.applyMatch(match());

    expect(await progression.getProgress(ACCOUNT.id)).toEqual(expect.objectContaining({ xp: 30, wins: 1 }));
    expect(published.filter((p) => p.payload.progress.playerId === ACCOUNT.id)).toHaveLength(1);
  });
});

describe("progressionComponent and deleted players (CC-035)", () => {
  const STAND = { playerId: "deleted_00000000-0000-4000-8000-000000000009", displayName: "Deleted player" };

  it("gives a deleted player's stand-in no progress, and the other player theirs", async () => {
    const { progression, published } = setup();

    const updates = await progression.applyMatch(
      match({ players: [PLAYERS[0], STAND], credit: { notCounted: [] } }),
    );

    expect(updates.map((u) => u.playerId)).toEqual(["guest_a"]);
    expect(published).toHaveLength(1);
    expect((await progression.getProgress(STAND.playerId)).matchesPlayed).toBe(0);
  });

  it("exports a player's progress and erases it", async () => {
    const { progression } = setup();
    await progression.applyMatch(match({ credit: { notCounted: [] } }));

    expect(await progression.exportPlayer({ playerId: "guest_a" })).toEqual(
      expect.objectContaining({ xp: 30, level: 1, matchesPlayed: 1, wins: 1 }),
    );
    expect(await progression.erasePlayer({ playerId: "guest_a" })).toEqual({ erased: { progress: 1 } });
    expect((await progression.getProgress("guest_a")).xp).toBe(0);
  });
});
