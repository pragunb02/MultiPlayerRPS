import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const T0 = new Date(Date.UTC(2026, 9, 19, 12));
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const OTHER_GUEST = "guest_00000000-0000-4000-8000-000000000002";

let counter = 0;
/** A block record as the accessor writes it, with a fresh block id unless one is given. */
const record = ({ blockerId, blockedId, seconds = 0, blockedName = "Someone", blockId }) => ({
  blockId: blockId ?? `00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`,
  blockerId,
  blockedId,
  blockedName,
  createdAt: at(seconds),
});

/**
 * Behaviour every block DAO must have (CC-044): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/blockDao.js").createBlockDao>>} createDao
 */
export function runBlockDaoContract(createDao) {
  it("stores a block and reads it back by the pair", async () => {
    const dao = await createDao();
    const block = record({ blockerId: RIYA, blockedId: GUEST, blockedName: "Guest-T001" });

    const stored = await dao.insert(block);

    expect(stored).toEqual(block);
    expect(await dao.getByPair({ blockerId: RIYA, blockedId: GUEST })).toEqual(block);
  });

  it("allows one block per pair, and the other direction is a pair of its own", async () => {
    const dao = await createDao();
    await dao.insert(record({ blockerId: RIYA, blockedId: GUEST }));

    await expect(dao.insert(record({ blockerId: RIYA, blockedId: GUEST }))).rejects.toThrow(DuplicateKey);
    await expect(dao.insert(record({ blockerId: GUEST, blockedId: RIYA }))).resolves.toBeDefined();
  });

  it("throws for a pair without a block", async () => {
    const dao = await createDao();
    await dao.insert(record({ blockerId: RIYA, blockedId: GUEST }));

    await expect(dao.getByPair({ blockerId: GUEST, blockedId: RIYA })).rejects.toThrow(RangeError);
  });

  it("lists one player's blocks newest first, nobody else's", async () => {
    const dao = await createDao();
    await dao.insert(record({ blockerId: RIYA, blockedId: GUEST, seconds: 1 }));
    await dao.insert(record({ blockerId: RIYA, blockedId: ARJUN, seconds: 3 }));
    await dao.insert(record({ blockerId: RIYA, blockedId: OTHER_GUEST, seconds: 2 }));
    await dao.insert(record({ blockerId: ARJUN, blockedId: RIYA, seconds: 4 }));

    const listed = await dao.listByBlocker(RIYA);

    expect(listed.map((block) => block.blockedId)).toEqual([ARJUN, OTHER_GUEST, GUEST]);
    expect(await dao.listByBlocker(GUEST)).toEqual([]);
  });

  it("lists every block on either side of a player", async () => {
    const dao = await createDao();
    await dao.insert(record({ blockerId: RIYA, blockedId: GUEST }));
    await dao.insert(record({ blockerId: ARJUN, blockedId: RIYA }));
    await dao.insert(record({ blockerId: ARJUN, blockedId: GUEST }));

    const involving = await dao.listInvolving(RIYA);

    expect(involving.map(({ blockerId, blockedId }) => [blockerId, blockedId]).sort()).toEqual(
      [
        [RIYA, GUEST],
        [ARJUN, RIYA],
      ].sort(),
    );
  });

  it("deletes a block only for the player who made it", async () => {
    const dao = await createDao();
    const block = await dao.insert(record({ blockerId: RIYA, blockedId: GUEST }));

    expect(await dao.deleteOwn({ blockerId: GUEST, blockId: block.blockId })).toBe(0);
    expect(await dao.deleteOwn({ blockerId: RIYA, blockId: "00000000-0000-4000-9000-ffffffffffff" })).toBe(0);
    expect(await dao.listByBlocker(RIYA)).toHaveLength(1);
    expect(await dao.deleteOwn({ blockerId: RIYA, blockId: block.blockId })).toBe(1);
    expect(await dao.listByBlocker(RIYA)).toEqual([]);
  });

  it("keeps only the newest blocks of a player, dropping the oldest", async () => {
    const dao = await createDao();
    for (const [blockedId, seconds] of [
      [GUEST, 1],
      [ARJUN, 3],
      [OTHER_GUEST, 2],
    ]) {
      await dao.insert(record({ blockerId: RIYA, blockedId, seconds }));
    }
    await dao.insert(record({ blockerId: ARJUN, blockedId: GUEST, seconds: 0 }));

    expect(await dao.keepNewest({ blockerId: RIYA, keep: 2 })).toBe(1);
    expect(await dao.keepNewest({ blockerId: RIYA, keep: 2 })).toBe(0);

    expect((await dao.listByBlocker(RIYA)).map((block) => block.blockedId)).toEqual([ARJUN, OTHER_GUEST]);
    expect(await dao.listByBlocker(ARJUN)).toHaveLength(1);
  });

  it("moves the blocks a guest made to an account, dropping pairs the account already has or that name it (ADR-014)", async () => {
    const dao = await createDao();
    await dao.insert(record({ blockerId: GUEST, blockedId: ARJUN, blockedName: "Arjun" }));
    await dao.insert(record({ blockerId: GUEST, blockedId: OTHER_GUEST }));
    await dao.insert(record({ blockerId: GUEST, blockedId: RIYA }));
    const already = await dao.insert(record({ blockerId: RIYA, blockedId: OTHER_GUEST, seconds: 9 }));

    expect(await dao.moveBlocker({ from: GUEST, to: RIYA })).toBe(1);
    expect(await dao.moveBlocker({ from: GUEST, to: RIYA })).toBe(0);

    expect(await dao.listByBlocker(GUEST)).toEqual([]);
    const moved = await dao.listByBlocker(RIYA);
    expect(moved.map((block) => block.blockedId).sort()).toEqual([ARJUN, OTHER_GUEST].sort());
    expect(moved.find((block) => block.blockedId === ARJUN).blockedName).toBe("Arjun");
    expect(moved.find((block) => block.blockedId === OTHER_GUEST)).toEqual(already);
  });

  it("moves the blocks others made on a guest to the account, keeping the name the blocker saw (ADR-014)", async () => {
    const dao = await createDao();
    await dao.insert(record({ blockerId: ARJUN, blockedId: GUEST, blockedName: "Guest-T001" }));
    await dao.insert(record({ blockerId: OTHER_GUEST, blockedId: GUEST }));
    await dao.insert(record({ blockerId: OTHER_GUEST, blockedId: RIYA }));
    await dao.insert(record({ blockerId: RIYA, blockedId: GUEST }));

    expect(await dao.moveBlocked({ from: GUEST, to: RIYA })).toBe(1);
    expect(await dao.moveBlocked({ from: GUEST, to: RIYA })).toBe(0);

    expect(await dao.getByPair({ blockerId: ARJUN, blockedId: RIYA })).toEqual(
      expect.objectContaining({ blockedName: "Guest-T001" }),
    );
    expect((await dao.listInvolving(GUEST)).length).toBe(0);
    expect(await dao.listByBlocker(OTHER_GUEST)).toHaveLength(1);
    expect(await dao.listByBlocker(RIYA)).toEqual([]);
  });

  it("deletes every block on either side of a player, and nobody else's (CC-035)", async () => {
    const dao = await createDao();
    await dao.insert(record({ blockerId: RIYA, blockedId: GUEST }));
    await dao.insert(record({ blockerId: ARJUN, blockedId: RIYA }));
    await dao.insert(record({ blockerId: ARJUN, blockedId: GUEST }));

    expect(await dao.deleteInvolving(RIYA)).toBe(2);
    expect(await dao.deleteInvolving(RIYA)).toBe(0);

    expect(await dao.listInvolving(RIYA)).toEqual([]);
    expect(await dao.listByBlocker(ARJUN)).toHaveLength(1);
  });
}
