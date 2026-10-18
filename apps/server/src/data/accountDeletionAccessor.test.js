import { describe, expect, it } from "vitest";
import { createInMemoryAccountDeletionDao } from "../testing/inMemoryAccountDeletionDao.js";
import { createMemoryStoreSessionDao } from "../testing/memoryStoreSessionDao.js";
import { createAccountDeletionAccessor, createSessionAccessor } from "./accountDeletionAccessor.js";

const AT = Date.UTC(2026, 9, 18, 10);
const PLAYER = "user_0123456789abcdef01234567";

describe("accountDeletionAccessor", () => {
  it("records a deletion and lists it with ms times once its sweep is due", async () => {
    const deletions = createAccountDeletionAccessor({
      accountDeletionDao: createInMemoryAccountDeletionDao(),
    });

    await deletions.record({ playerId: PLAYER, requestedAt: AT, sweepAgainAt: AT + 5, expiresAt: AT + 50 });

    expect(await deletions.listDue({ now: AT + 4, limit: 5 })).toEqual([]);
    const due = await deletions.listDue({ now: AT + 5, limit: 5 });
    expect(due).toEqual([{ playerId: PLAYER, requestedAt: AT, formerIds: [] }]);
    expect(Object.isFrozen(due)).toBe(true);
    await deletions.markSwept(PLAYER);
    expect(await deletions.listDue({ now: AT + 5, limit: 5 })).toEqual([]);
  });

  it("moves a deletion's next sweep later (CC-035)", async () => {
    const deletions = createAccountDeletionAccessor({
      accountDeletionDao: createInMemoryAccountDeletionDao(),
    });
    await deletions.record({ playerId: PLAYER, requestedAt: AT, sweepAgainAt: AT, expiresAt: AT + 50 });

    await deletions.sweepAgainAt({ playerId: PLAYER, at: AT + 10 });

    expect(await deletions.listDue({ now: AT + 9, limit: 5 })).toEqual([]);
    expect(await deletions.listDue({ now: AT + 10, limit: 5 })).toHaveLength(1);
  });

  it("closes a legacy row and recognises it afterwards", async () => {
    const deletions = createAccountDeletionAccessor({
      accountDeletionDao: createInMemoryAccountDeletionDao(),
    });

    await deletions.closeLegacy({ legacyId: "legacy-0", at: AT });

    expect(await deletions.isLegacyClosed("legacy-0")).toBe(true);
    expect(await deletions.isLegacyClosed("legacy-1")).toBe(false);
  });

  it("fails fast without its DAO", () => {
    expect(() => createAccountDeletionAccessor({})).toThrow(TypeError);
  });
});

describe("sessionAccessor", () => {
  it("removes every session of a player", async () => {
    const removed = [];
    const sessions = createSessionAccessor({
      sessionDao: { deleteByPlayer: async (playerId) => removed.push(playerId) },
    });

    await sessions.removePlayer(PLAYER);

    expect(removed).toEqual([PLAYER]);
  });

  it("works over the memory store double", async () => {
    const store = { all: (done) => done(null, {}), destroy: (sid, done) => done() };
    const sessions = createSessionAccessor({ sessionDao: createMemoryStoreSessionDao({ store }) });

    expect(await sessions.removePlayer(PLAYER)).toBe(0);
  });

  it("fails fast without its DAO", () => {
    expect(() => createSessionAccessor({})).toThrow(TypeError);
  });
});
