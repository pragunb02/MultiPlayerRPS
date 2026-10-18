import { expect, it } from "vitest";

const MINUTE_MS = 60 * 1000;
const AT = new Date(Date.UTC(2026, 9, 18, 10));
const later = (minutes) => new Date(AT.getTime() + minutes * MINUTE_MS);
const deletion = (overrides = {}) => ({
  playerId: "user_0123456789abcdef01234567",
  requestedAt: AT,
  sweepAgainAt: later(5),
  expiresAt: later(30 * 24 * 60),
  ...overrides,
});

/**
 * Behaviour every account deletion DAO must have (MongoDB DAO and the in-memory double, CC-035).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/accountDeletionDao.js").createAccountDeletionDao>>} createDao
 */
export function runAccountDeletionDaoContract(createDao) {
  it("lists a deletion once its second sweep is due, and not before", async () => {
    const dao = await createDao();
    await dao.insert(deletion());

    expect(await dao.listDue({ now: later(4), limit: 10 })).toEqual([]);
    expect(await dao.listDue({ now: later(5), limit: 10 })).toEqual([
      { playerId: "user_0123456789abcdef01234567", requestedAt: AT },
    ]);
  });

  it("keeps the first record when the same player is recorded again", async () => {
    const dao = await createDao();
    await dao.insert(deletion());

    await dao.insert(deletion({ requestedAt: later(1), sweepAgainAt: later(60) }));

    expect(await dao.listDue({ now: later(5), limit: 10 })).toEqual([
      { playerId: "user_0123456789abcdef01234567", requestedAt: AT },
    ]);
  });

  it("stops listing a deletion once it was swept again, and marking twice changes nothing", async () => {
    const dao = await createDao();
    await dao.insert(deletion());

    await dao.markSwept("user_0123456789abcdef01234567");
    await dao.markSwept("user_0123456789abcdef01234567");
    await dao.markSwept("user_ffffffffffffffffffffffff");

    expect(await dao.listDue({ now: later(60), limit: 10 })).toEqual([]);
  });

  it("lists the oldest due deletions first, at most the limit", async () => {
    const dao = await createDao();
    await dao.insert(deletion({ playerId: "user_b", sweepAgainAt: later(6) }));
    await dao.insert(deletion({ playerId: "user_a", sweepAgainAt: later(5) }));
    await dao.insert(deletion({ playerId: "user_c", sweepAgainAt: later(7) }));

    const due = await dao.listDue({ now: later(10), limit: 2 });

    expect(due.map((entry) => entry.playerId)).toEqual(["user_a", "user_b"]);
  });

  it("remembers a closed legacy row, and closing it again changes nothing", async () => {
    const dao = await createDao();

    expect(await dao.isLegacyClosed("64b7f0c2a1b2c3d4e5f60718")).toBe(false);
    await dao.closeLegacy({ legacyId: "64b7f0c2a1b2c3d4e5f60718", closedAt: AT });
    await dao.closeLegacy({ legacyId: "64b7f0c2a1b2c3d4e5f60718", closedAt: later(1) });

    expect(await dao.isLegacyClosed("64b7f0c2a1b2c3d4e5f60718")).toBe(true);
    expect(await dao.isLegacyClosed("64b7f0c2a1b2c3d4e5f60719")).toBe(false);
  });

  it("moves a deletion's next sweep to a later time (CC-035)", async () => {
    const dao = await createDao();
    await dao.insert(deletion());

    await dao.sweepAgainAt({ playerId: "user_0123456789abcdef01234567", at: later(10) });
    await dao.sweepAgainAt({ playerId: "user_ffffffffffffffffffffffff", at: later(10) });

    expect(await dao.listDue({ now: later(9), limit: 10 })).toEqual([]);
    expect(await dao.listDue({ now: later(10), limit: 10 })).toHaveLength(1);
  });
}
