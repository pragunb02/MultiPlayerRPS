import { describe, expect, it } from "vitest";
import { createInMemoryPendingMatchDao } from "../testing/inMemoryPendingMatchDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createPendingMatchAccessor } from "./pendingMatchAccessor.js";

const T0 = Date.UTC(2026, 9, 18, 12);
const MATCH = Object.freeze({ matchId: "m1", players: [{ playerId: "guest_a", displayName: "Alice" }] });

const setup = () => createPendingMatchAccessor({ pendingMatchDao: createInMemoryPendingMatchDao() });

describe("pendingMatchAccessor", () => {
  it("adds a finished game due at once, and reads it back frozen with times in ms", async () => {
    const outbox = setup();

    expect(await outbox.add({ match: MATCH, at: T0 })).toBe(true);
    const stored = await outbox.get("m1");

    expect(stored).toEqual({
      matchId: "m1",
      match: MATCH,
      status: "pending",
      done: [],
      attempts: 0,
      nextAttemptAt: T0,
      createdAt: T0,
    });
    expect(Object.isFrozen(stored.match.players[0])).toBe(true);
    expect(await outbox.add({ match: MATCH, at: T0 + 1 })).toBe(false);
  });

  it("answers NotFoundError for a game it does not have, and passes other failures on", async () => {
    const failure = new Error("db down");
    const broken = createPendingMatchAccessor({
      pendingMatchDao: {
        get: async () => {
          throw failure;
        },
      },
    });

    await expect(setup().get("nope")).rejects.toThrow(NotFoundError);
    await expect(broken.get("m1")).rejects.toBe(failure);
  });

  it("keeps the steps done, the failures and the end", async () => {
    const outbox = setup();
    await outbox.add({ match: MATCH, at: T0 });

    await outbox.stepDone({ matchId: "m1", step: "record match" });
    await outbox.attemptFailed({
      matchId: "m1",
      failed: false,
      attempts: 1,
      nextAttemptAt: T0 + 2_000,
      lastError: { step: "judge", message: "db down" },
    });
    const retrying = await outbox.get("m1");
    const due = await outbox.listDue({ now: T0 + 2_000, limit: 10 });
    await outbox.attemptFailed({
      matchId: "m1",
      failed: true,
      attempts: 2,
      nextAttemptAt: T0 + 6_000,
      lastError: { step: "judge", message: "db down" },
    });
    const failed = await outbox.get("m1");

    expect(retrying).toEqual(
      expect.objectContaining({
        status: "pending",
        done: ["record match"],
        attempts: 1,
        nextAttemptAt: T0 + 2_000,
        lastError: { step: "judge", message: "db down" },
      }),
    );
    expect(due.map((entry) => entry.matchId)).toEqual(["m1"]);
    expect(failed.status).toBe("failed");
  });

  it("marks a game done", async () => {
    const outbox = setup();
    await outbox.add({ match: MATCH, at: T0 });

    await outbox.done({ matchId: "m1", at: T0 + 1, keepUntil: T0 + 10 });

    expect((await outbox.get("m1")).status).toBe("done");
    expect(await outbox.listDue({ now: T0 + 5, limit: 10 })).toEqual([]);
  });

  it("fails fast without its DAO", () => {
    expect(() => createPendingMatchAccessor({})).toThrow(TypeError);
  });

  it("lists a player's records and replaces the match in one while the player is in it (CC-035)", async () => {
    const outbox = setup();
    await outbox.add({ match: MATCH, at: T0 });
    const renamed = { ...MATCH, players: [{ playerId: "deleted_1", displayName: "Deleted player" }] };

    expect((await outbox.listForPlayer("guest_a")).map((entry) => entry.matchId)).toEqual(["m1"]);
    expect(await outbox.replaceMatch({ matchId: "m1", from: "guest_a", match: renamed })).toBe(true);
    expect(await outbox.listForPlayer("guest_a")).toEqual([]);
    expect((await outbox.get("m1")).match).toEqual(renamed);
  });
});
