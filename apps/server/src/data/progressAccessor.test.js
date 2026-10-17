import { describe, expect, it } from "vitest";
import { createInMemoryProgressDao } from "../testing/inMemoryProgressDao.js";
import { ConflictError } from "../utils/errors.js";
import { createProgressAccessor } from "./progressAccessor.js";

const setup = () => createProgressAccessor({ progressDao: createInMemoryProgressDao() });

describe("progressAccessor", () => {
  it("treats a player with no games as zero progress (a domain default, not an error)", async () => {
    expect(await setup().get("guest_new")).toEqual({
      playerId: "guest_new",
      xp: 0,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    });
  });

  it("returns totals before and after applying a match", async () => {
    const progress = setup();

    const { applied, before, after } = await progress.applyMatchOnce({
      playerId: "guest_a",
      matchId: "m1",
      inc: { xp: 30, matchesPlayed: 1, wins: 1 },
      at: Date.UTC(2026, 9, 16),
    });

    expect(applied).toBe(true);
    expect(before.xp).toBe(0);
    expect(after).toEqual({ playerId: "guest_a", xp: 30, matchesPlayed: 1, wins: 1, losses: 0, draws: 0 });
    expect(await progress.get("guest_a")).toEqual(after);
  });

  it("reports a repeated match as not applied, with unchanged totals", async () => {
    const progress = setup();
    const change = { playerId: "guest_a", matchId: "m1", inc: { xp: 30, matchesPlayed: 1, wins: 1 }, at: 0 };
    await progress.applyMatchOnce(change);

    const again = await progress.applyMatchOnce(change);

    expect(again.applied).toBe(false);
    expect(again.after).toEqual(again.before);
  });

  it("adds a bonus once per key, as XP only (no match played)", async () => {
    const progress = setup();
    const award = {
      playerId: "guest_a",
      key: "quest:2026-10-16:win-1",
      inc: { xp: 20 },
      at: Date.UTC(2026, 9, 16),
    };

    const first = await progress.applyAwardOnce(award);
    const again = await progress.applyAwardOnce(award);

    expect(first.after).toEqual(expect.objectContaining({ xp: 20, matchesPlayed: 0 }));
    expect(again.applied).toBe(false);
    expect((await progress.get("guest_a")).xp).toBe(20);
  });

  it("passes unexpected storage failures through", async () => {
    const failure = new Error("disk on fire");
    const progress = createProgressAccessor({
      progressDao: {
        getByPlayer: async () => {
          throw failure;
        },
      },
    });

    await expect(progress.get("guest_a")).rejects.toBe(failure);
  });
});

describe("progressAccessor: a guest's progress moving to an account (CC-032)", () => {
  const WIN = { xp: 30, matchesPlayed: 1, wins: 1 };
  const play = (progress, playerId, matchId) =>
    progress.applyMatchOnce({ playerId, matchId, inc: WIN, at: Date.UTC(2026, 9, 16) });

  it("adds the guest's totals to the account and reports what moved", async () => {
    const progress = setup();
    await play(progress, "guest_a", "m1");
    await play(progress, "user_1", "m2");

    const result = await progress.mergeInto({ from: "guest_a", to: "user_1", at: 1, withdraw: {} });

    expect(result).toEqual({ moved: { xp: 30, matchesPlayed: 1, wins: 1, losses: 0, draws: 0 } });
    expect((await progress.get("user_1")).xp).toBe(60);
  });

  it("leaves out what the guest earned from games that stopped counting, never going below zero", async () => {
    const progress = setup();
    await play(progress, "guest_a", "m1");
    await play(progress, "user_1", "m2");

    const result = await progress.mergeInto({
      from: "guest_a",
      to: "user_1",
      at: 1,
      withdraw: { xp: 20, matchesPlayed: 1, losses: 1 },
    });

    expect(result).toEqual({ moved: { xp: 10, matchesPlayed: 0, wins: 1, losses: 0, draws: 0 } });
    expect(await progress.get("user_1")).toEqual(expect.objectContaining({ xp: 40, matchesPlayed: 1 }));
  });

  it("moves nothing the second time", async () => {
    const progress = setup();
    await play(progress, "guest_a", "m1");
    await progress.mergeInto({ from: "guest_a", to: "user_1", at: 1, withdraw: {} });

    const again = await progress.mergeInto({ from: "guest_a", to: "user_1", at: 2, withdraw: {} });

    expect(again.moved).toEqual({ xp: 0, matchesPlayed: 0, wins: 0, losses: 0, draws: 0 });
    expect((await progress.get("user_1")).xp).toBe(30);
  });

  it("refuses to move a guest's progress to a second account", async () => {
    const progress = setup();
    await progress.mergeInto({ from: "guest_a", to: "user_1", at: 1, withdraw: {} });

    await expect(progress.mergeInto({ from: "guest_a", to: "user_2", at: 2, withdraw: {} })).rejects.toThrow(
      ConflictError,
    );
  });

  it("passes unexpected storage failures through", async () => {
    const failure = new Error("disk on fire");
    const progress = createProgressAccessor({
      progressDao: {
        markMergedInto: async () => {
          throw failure;
        },
      },
    });

    await expect(progress.mergeInto({ from: "guest_a", to: "user_1", at: 1, withdraw: {} })).rejects.toBe(
      failure,
    );
  });

  it("counts a match that finished during the move for the account", async () => {
    const progress = setup();
    await play(progress, "user_1", "m-own");
    await progress.mergeInto({ from: "guest_a", to: "user_1", at: 1, withdraw: {} });

    const late = await play(progress, "guest_a", "m-late");
    const replay = await play(progress, "guest_a", "m-late");

    expect(late).toEqual(
      expect.objectContaining({
        applied: true,
        after: expect.objectContaining({ playerId: "user_1", xp: 60 }),
      }),
    );
    expect(replay.applied).toBe(false);
    expect((await progress.get("user_1")).xp).toBe(60);
  });

  it("pays a quest bonus earned during the move to the account, once (CC-089)", async () => {
    const progress = setup();
    await progress.mergeInto({ from: "guest_a", to: "user_1", at: 1, withdraw: {} });
    const award = { playerId: "guest_a", key: "quest:2026-10-16:win-1", inc: { xp: 20 }, at: 2 };

    const late = await progress.applyAwardOnce(award);
    const again = await progress.applyAwardOnce(award);

    expect(late.after).toEqual(expect.objectContaining({ playerId: "user_1", xp: 20, matchesPlayed: 0 }));
    expect(again.applied).toBe(false);
    expect((await progress.get("user_1")).xp).toBe(20);
  });
});
