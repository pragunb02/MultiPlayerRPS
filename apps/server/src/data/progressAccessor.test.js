import { describe, expect, it } from "vitest";
import { createInMemoryProgressDao } from "../testing/inMemoryProgressDao.js";
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
