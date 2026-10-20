import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const T0 = new Date(Date.UTC(2026, 9, 16, 12));
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
const ACCOUNT = { kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" };
const MOVED = { xp: 40, matchesPlayed: 2, matches: 2 };

/**
 * Behaviour every player-transfer DAO must have (MongoDB DAO and the in-memory double).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/playerTransferDao.js").createPlayerTransferDao>>} createDao
 */
export function runPlayerTransferDaoContract(createDao) {
  it("records a pending transfer and reads it back", async () => {
    const dao = await createDao();

    const stored = await dao.insertPending({ from: "guest_a", to: ACCOUNT, createdAt: T0 });

    expect(stored).toEqual({ from: "guest_a", to: ACCOUNT, status: "pending", createdAt: T0 });
    expect(await dao.getByFrom("guest_a")).toEqual(stored);
  });

  it("allows one transfer per guest", async () => {
    const dao = await createDao();
    await dao.insertPending({ from: "guest_a", to: ACCOUNT, createdAt: T0 });

    await expect(dao.insertPending({ from: "guest_a", to: ACCOUNT, createdAt: at(1) })).rejects.toThrow(
      DuplicateKey,
    );
  });

  it("throws for a guest without a transfer", async () => {
    const dao = await createDao();

    await expect(dao.getByFrom("guest_nobody")).rejects.toThrow(RangeError);
  });

  it("marks a transfer done once, keeping what moved the first time", async () => {
    const dao = await createDao();
    await dao.insertPending({ from: "guest_a", to: ACCOUNT, createdAt: T0 });

    await dao.markDone({ from: "guest_a", completedAt: at(1), carriedOver: MOVED });
    await dao.markDone({
      from: "guest_a",
      completedAt: at(2),
      carriedOver: { xp: 0, matchesPlayed: 0, matches: 0 },
    });
    await dao.markDone({ from: "guest_nobody", completedAt: at(2), carriedOver: MOVED });

    expect(await dao.getByFrom("guest_a")).toEqual({
      from: "guest_a",
      to: ACCOUNT,
      status: "done",
      createdAt: T0,
      completedAt: at(1),
      carriedOver: MOVED,
    });
    await expect(dao.getByFrom("guest_nobody")).rejects.toThrow(RangeError);
  });

  it("lists pending transfers created before a time, oldest first, up to a limit", async () => {
    const dao = await createDao();
    for (const [from, seconds] of [
      ["guest_c", 3],
      ["guest_a", 1],
      ["guest_b", 2],
      ["guest_new", 60],
    ]) {
      await dao.insertPending({ from, to: ACCOUNT, createdAt: at(seconds) });
    }
    await dao.markDone({ from: "guest_b", completedAt: at(4), carriedOver: MOVED });

    const pending = await dao.listPending({ createdBefore: at(30), limit: 10 });
    const first = await dao.listPending({ createdBefore: at(30), limit: 1 });

    expect(pending.map((t) => t.from)).toEqual(["guest_a", "guest_c"]);
    expect(first.map((t) => t.from)).toEqual(["guest_a"]);
  });

  it("finds the transfers of any of the given players", async () => {
    const dao = await createDao();
    await dao.insertPending({ from: "guest_a", to: ACCOUNT, createdAt: T0 });
    await dao.insertPending({ from: "guest_b", to: ACCOUNT, createdAt: T0 });
    await dao.markDone({ from: "guest_b", completedAt: at(1), carriedOver: MOVED });

    const found = await dao.listByFrom(["guest_b", "guest_x", "user_0123456789abcdef01234567"]);

    expect(found).toEqual([expect.objectContaining({ from: "guest_b", status: "done" })]);
    expect(await dao.listByFrom([])).toEqual([]);
  });

  it("lists the pending transfers into any of the given accounts (CC-291)", async () => {
    const dao = await createDao();
    const other = { ...ACCOUNT, id: "user_ffffffffffffffffffffffff", displayName: "Arjun" };
    const third = { ...ACCOUNT, id: "user_eeeeeeeeeeeeeeeeeeeeeeee", displayName: "Sam" };
    await dao.insertPending({ from: "guest_a", to: ACCOUNT, createdAt: T0 });
    await dao.insertPending({ from: "guest_b", to: other, createdAt: T0 });
    await dao.markDone({ from: "guest_b", completedAt: at(1), carriedOver: MOVED });
    await dao.insertPending({ from: "guest_c", to: third, createdAt: T0 });

    const pending = await dao.listPendingTo([ACCOUNT.id, other.id]);

    expect(pending).toEqual([expect.objectContaining({ from: "guest_a", status: "pending", to: ACCOUNT })]);
    expect(await dao.listPendingTo([])).toEqual([]);
  });

  it("lists and deletes the transfers into one account, nobody else's (CC-035)", async () => {
    const dao = await createDao();
    await dao.insertPending({ from: "guest_a", to: ACCOUNT, createdAt: T0 });
    await dao.markDone({ from: "guest_a", completedAt: at(1), carriedOver: MOVED });
    await dao.insertPending({ from: "guest_b", to: ACCOUNT, createdAt: at(2) });
    const other = { ...ACCOUNT, id: "user_ffffffffffffffffffffffff", displayName: "Arjun" };
    await dao.insertPending({ from: "guest_c", to: other, createdAt: at(3) });

    const listed = await dao.listByTo(ACCOUNT.id);
    expect(listed.map((transfer) => transfer.from)).toEqual(["guest_a", "guest_b"]);
    expect(listed[0]).toEqual({
      from: "guest_a",
      to: ACCOUNT,
      status: "done",
      createdAt: T0,
      completedAt: at(1),
      carriedOver: MOVED,
    });

    expect(await dao.deleteByTo(ACCOUNT.id)).toBe(2);
    expect(await dao.deleteByTo(ACCOUNT.id)).toBe(0);
    expect(await dao.listByTo(ACCOUNT.id)).toEqual([]);
    expect((await dao.getByFrom("guest_c")).to.id).toBe(other.id);
  });
}
