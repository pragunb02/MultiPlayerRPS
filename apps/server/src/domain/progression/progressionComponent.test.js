import { describe, expect, it } from "vitest";
import { MAX_LEVEL } from "@classicade/shared";
import { createProgressAccessor } from "../../data/progressAccessor.js";
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
  const progression = createProgressionComponent({
    progressAccessor: createProgressAccessor({ progressDao }),
    events: { emit: (event, payload) => published.push({ event, payload }) },
  });
  return { progression, published, progressDao };
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
        }),
      },
    ]);
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

  it("awards a match that finished during the move to the account, once", async () => {
    const { progression, published } = setup();
    await progression.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    await progression.applyMatch(match());
    await progression.applyMatch(match());

    expect(await progression.getProgress(ACCOUNT.id)).toEqual(expect.objectContaining({ xp: 30, wins: 1 }));
    expect(published.filter((p) => p.payload.progress.playerId === ACCOUNT.id)).toHaveLength(1);
  });
});
