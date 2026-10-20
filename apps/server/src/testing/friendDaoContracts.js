import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const T0 = new Date(Date.UTC(2026, 9, 20, 12));
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const MEERA = "user_aaaaaaaaaaaaaaaaaaaaaaaa";
const KABIR = "user_bbbbbbbbbbbbbbbbbbbbbbbb";

/**
 * Behaviour every friendship DAO must have (CC-052): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/friendshipDao.js").createFriendshipDao>>} createDao
 */
export function runFriendshipDaoContract(createDao) {
  const pair = (low, high, seconds = 0) => ({ low, high, createdAt: at(seconds) });

  it("stores a friendship once per pair", async () => {
    const dao = await createDao();

    expect(await dao.insert(pair(RIYA, ARJUN))).toEqual(pair(RIYA, ARJUN));
    await expect(dao.insert(pair(RIYA, ARJUN, 5))).rejects.toThrow(DuplicateKey);
    expect(await dao.exists({ low: RIYA, high: ARJUN })).toBe(true);
    expect(await dao.exists({ low: ARJUN, high: RIYA })).toBe(false);
  });

  it("lists and counts a player's friendships on either side, oldest first", async () => {
    const dao = await createDao();
    await dao.insert(pair(MEERA, RIYA, 2));
    await dao.insert(pair(RIYA, ARJUN, 1));
    await dao.insert(pair(KABIR, ARJUN, 3));

    expect(await dao.listFor(RIYA)).toEqual([pair(RIYA, ARJUN, 1), pair(MEERA, RIYA, 2)]);
    expect(await dao.countFor(RIYA)).toBe(2);
    expect(await dao.countFor(KABIR)).toBe(1);
    expect(await dao.listFor("user_000000000000000000000000")).toEqual([]);
  });

  it("deletes one pair, and every friendship of a player", async () => {
    const dao = await createDao();
    await dao.insert(pair(MEERA, RIYA));
    await dao.insert(pair(RIYA, ARJUN));
    await dao.insert(pair(KABIR, ARJUN));

    expect(await dao.deletePair({ low: MEERA, high: RIYA })).toBe(1);
    expect(await dao.deletePair({ low: MEERA, high: RIYA })).toBe(0);
    expect(await dao.deleteInvolving(ARJUN)).toBe(2);
    expect(await dao.countFor(RIYA)).toBe(0);
  });
}

let counter = 0;
const newRequestId = () => `00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;

/**
 * Behaviour every friend request DAO must have (CC-052).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/friendRequestDao.js").createFriendRequestDao>>} createDao
 */
export function runFriendRequestDaoContract(createDao) {
  const request = ({ senderId, recipientId, seconds = 0, status = "pending", lastsSeconds = 3600 }) => ({
    requestId: newRequestId(),
    senderId,
    recipientId,
    via: "game",
    status,
    createdAt: at(seconds),
    notifiedAt: at(seconds),
    expiresAt: at(seconds + lastsSeconds),
  });

  it("stores one request per sender and recipient, and the other way is a request of its own", async () => {
    const dao = await createDao();
    const sent = request({ senderId: RIYA, recipientId: ARJUN });

    expect(await dao.insert(sent)).toEqual(sent);
    await expect(dao.insert(request({ senderId: RIYA, recipientId: ARJUN }))).rejects.toThrow(DuplicateKey);
    await expect(
      dao.insert({ ...request({ senderId: KABIR, recipientId: MEERA }), requestId: sent.requestId }),
    ).rejects.toThrow(DuplicateKey);
    await expect(dao.insert(request({ senderId: ARJUN, recipientId: RIYA }))).resolves.toBeDefined();
    expect(await dao.getByPair({ senderId: RIYA, recipientId: ARJUN })).toEqual(sent);
  });

  it("reads a request by id only while it lasts, and by pair even after", async () => {
    const dao = await createDao();
    const sent = await dao.insert(request({ senderId: RIYA, recipientId: ARJUN, lastsSeconds: 10 }));

    expect(await dao.getLive({ requestId: sent.requestId, now: at(9) })).toEqual(sent);
    await expect(dao.getLive({ requestId: sent.requestId, now: at(10) })).rejects.toThrow(RangeError);
    await expect(dao.getLive({ requestId: newRequestId(), now: at(0) })).rejects.toThrow(RangeError);
    expect(await dao.getByPair({ senderId: RIYA, recipientId: ARJUN })).toEqual(sent);
    await expect(dao.getByPair({ senderId: ARJUN, recipientId: RIYA })).rejects.toThrow(RangeError);
  });

  it("changes a request only while it has one of the given statuses", async () => {
    const dao = await createDao();
    const sent = await dao.insert(request({ senderId: RIYA, recipientId: ARJUN }));

    expect(
      await dao.update({ requestId: sent.requestId, statuses: ["declined"], set: { status: "withdrawn" } }),
    ).toBe(0);
    expect(
      await dao.update({ requestId: sent.requestId, statuses: ["pending"], set: { status: "declined" } }),
    ).toBe(1);
    expect(
      await dao.update({ requestId: newRequestId(), statuses: ["pending"], set: { status: "declined" } }),
    ).toBe(0);
    expect((await dao.getByPair({ senderId: RIYA, recipientId: ARJUN })).status).toBe("declined");
  });

  it("lists what a player sent and what was sent to them, newest first, by status, without the ones that ran out", async () => {
    const dao = await createDao();
    const toArjun = await dao.insert(request({ senderId: RIYA, recipientId: ARJUN, seconds: 1 }));
    const toMeera = await dao.insert(
      request({ senderId: RIYA, recipientId: MEERA, seconds: 3, status: "declined" }),
    );
    await dao.insert(request({ senderId: RIYA, recipientId: KABIR, seconds: 2, status: "withdrawn" }));
    await dao.insert(request({ senderId: KABIR, recipientId: MEERA, seconds: 0, lastsSeconds: 5 }));
    const fromArjun = await dao.insert(request({ senderId: ARJUN, recipientId: MEERA, seconds: 4 }));

    expect(await dao.listSentBy({ senderId: RIYA, statuses: ["pending", "declined"], now: at(10) })).toEqual([
      toMeera,
      toArjun,
    ]);
    expect(
      await dao.listSentTo({ recipientId: MEERA, statuses: ["pending"], now: at(10), limit: 50 }),
    ).toEqual([fromArjun]);
    expect(
      await dao.listSentTo({ recipientId: MEERA, statuses: ["pending", "declined"], now: at(4), limit: 1 }),
    ).toEqual([fromArjun]);
  });

  it("deletes the requests between two players either way, and every request of a player", async () => {
    const dao = await createDao();
    await dao.insert(request({ senderId: RIYA, recipientId: ARJUN }));
    await dao.insert(request({ senderId: ARJUN, recipientId: RIYA }));
    await dao.insert(request({ senderId: RIYA, recipientId: MEERA }));
    await dao.insert(request({ senderId: KABIR, recipientId: RIYA }));
    await dao.insert(request({ senderId: KABIR, recipientId: MEERA }));

    expect(await dao.deleteBetween({ a: ARJUN, b: RIYA })).toBe(2);
    expect(await dao.deleteInvolving(RIYA)).toBe(2);
    expect(await dao.listSentBy({ senderId: KABIR, statuses: ["pending"], now: at(0) })).toHaveLength(1);
  });
}

/**
 * Behaviour every friend link DAO must have (CC-052).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/friendLinkDao.js").createFriendLinkDao>>} createDao
 */
export function runFriendLinkDaoContract(createDao) {
  const link = (tokenHash, { creatorId = RIYA, seconds = 0, lastsSeconds = 60 } = {}) => ({
    tokenHash,
    creatorId,
    createdAt: at(seconds),
    expiresAt: at(seconds + lastsSeconds),
  });

  it("stores a link once per token hash and reads it while it works", async () => {
    const dao = await createDao();

    expect(await dao.insert(link("a".repeat(64)))).toEqual(link("a".repeat(64)));
    await expect(dao.insert(link("a".repeat(64), { creatorId: ARJUN }))).rejects.toThrow(DuplicateKey);
    expect(await dao.getLive({ tokenHash: "a".repeat(64), now: at(59) })).toEqual(link("a".repeat(64)));
    await expect(dao.getLive({ tokenHash: "a".repeat(64), now: at(60) })).rejects.toThrow(RangeError);
    await expect(dao.getLive({ tokenHash: "b".repeat(64), now: at(0) })).rejects.toThrow(RangeError);
  });

  it("takes a link out once, and never one that stopped working", async () => {
    const dao = await createDao();
    await dao.insert(link("a".repeat(64)));
    await dao.insert(link("b".repeat(64), { lastsSeconds: 5 }));

    expect(await dao.take({ tokenHash: "a".repeat(64), now: at(1) })).toEqual(link("a".repeat(64)));
    await expect(dao.take({ tokenHash: "a".repeat(64), now: at(1) })).rejects.toThrow(RangeError);
    await expect(dao.take({ tokenHash: "b".repeat(64), now: at(5) })).rejects.toThrow(RangeError);
  });

  it("lists a player's working links newest first, keeps the newest few, and deletes them all", async () => {
    const dao = await createDao();
    await dao.insert(link("a".repeat(64), { seconds: 1 }));
    await dao.insert(link("b".repeat(64), { seconds: 3 }));
    await dao.insert(link("c".repeat(64), { seconds: 2 }));
    await dao.insert(link("d".repeat(64), { seconds: 0, lastsSeconds: 2 }));
    await dao.insert(link("e".repeat(64), { creatorId: ARJUN }));

    expect((await dao.listBy({ creatorId: RIYA, now: at(3) })).map((each) => each.tokenHash[0])).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(await dao.keepNewest({ creatorId: RIYA, keep: 2 })).toBe(2);
    expect(await dao.keepNewest({ creatorId: RIYA, keep: 2 })).toBe(0);
    expect((await dao.listBy({ creatorId: RIYA, now: at(3) })).map((each) => each.tokenHash[0])).toEqual([
      "b",
      "c",
    ]);
    expect(await dao.deleteBy(RIYA)).toBe(2);
    expect(await dao.listBy({ creatorId: ARJUN, now: at(0) })).toHaveLength(1);
  });
}

/**
 * Behaviour every privacy DAO must have (CC-052).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/privacyDao.js").createPrivacyDao>>} createDao
 */
export function runPrivacyDaoContract(createDao) {
  it("sets a player's switches, making the document the first time, and reads them back", async () => {
    const dao = await createDao();

    expect(await dao.set({ playerId: RIYA, appearOffline: true, updatedAt: at(1) })).toEqual({
      playerId: RIYA,
      appearOffline: true,
      updatedAt: at(1),
    });
    expect(await dao.set({ playerId: RIYA, appearOffline: false, updatedAt: at(2) })).toEqual({
      playerId: RIYA,
      appearOffline: false,
      updatedAt: at(2),
    });
    await dao.set({ playerId: ARJUN, appearOffline: true, updatedAt: at(3) });

    const found = await dao.findByPlayers([RIYA, ARJUN, MEERA]);

    expect(found.sort((a, b) => a.updatedAt - b.updatedAt)).toEqual([
      { playerId: RIYA, appearOffline: false, updatedAt: at(2) },
      { playerId: ARJUN, appearOffline: true, updatedAt: at(3) },
    ]);
  });

  it("deletes a player's switches", async () => {
    const dao = await createDao();
    await dao.set({ playerId: RIYA, appearOffline: true, updatedAt: at(1) });

    expect(await dao.deleteByPlayer(RIYA)).toBe(1);
    expect(await dao.deleteByPlayer(RIYA)).toBe(0);
    expect(await dao.findByPlayers([RIYA])).toEqual([]);
  });
}
