import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const T0 = new Date(Date.UTC(2026, 9, 20, 12));
const T1 = new Date(T0.getTime() + 60_000);
const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

/**
 * Behaviour every profile DAO must have (CC-034): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/profileDao.js").createProfileDao>>} createDao
 */
export function runProfileDaoContract(createDao) {
  it("stores a new profile with only its handle and times", async () => {
    const dao = await createDao();

    const stored = await dao.insert({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });

    expect(stored).toEqual({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0, updatedAt: T0 });
  });

  it("refuses a second profile for a player and a handle another player has", async () => {
    const dao = await createDao();
    await dao.insert({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });

    await expect(dao.insert({ playerId: RIYA, handle: "bbbbbbbbbbbbbbbb", createdAt: T0 })).rejects.toThrow(
      DuplicateKey,
    );
    await expect(dao.insert({ playerId: ARJUN, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 })).rejects.toThrow(
      DuplicateKey,
    );
  });

  it("finds the profiles of the players that have one", async () => {
    const dao = await createDao();
    await dao.insert({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });
    await dao.insert({ playerId: ARJUN, handle: "bbbbbbbbbbbbbbbb", createdAt: T0 });

    const found = await dao.findByPlayers([RIYA, GUEST, RIYA]);

    expect(found.map((doc) => doc.playerId)).toEqual([RIYA]);
    expect(await dao.findByPlayers([])).toEqual([]);
  });

  it("reads a profile by handle, and nothing for a handle nobody has", async () => {
    const dao = await createDao();
    await dao.insert({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });

    expect((await dao.getByHandle("aaaaaaaaaaaaaaaa")).playerId).toBe(RIYA);
    await expect(dao.getByHandle("cccccccccccccccc")).rejects.toThrow(RangeError);
  });

  it("sets the avatar and the visibility, and changes nothing for a player without a profile", async () => {
    const dao = await createDao();
    await dao.insert({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });

    expect(await dao.update({ playerId: RIYA, set: { avatar: "owl" }, updatedAt: T1 })).toBe(1);
    expect(await dao.update({ playerId: RIYA, set: { visibility: "public" }, updatedAt: T1 })).toBe(1);
    expect(await dao.update({ playerId: GUEST, set: { avatar: "owl" }, updatedAt: T1 })).toBe(0);

    const [doc] = await dao.findByPlayers([RIYA]);
    expect(doc).toEqual({
      playerId: RIYA,
      handle: "aaaaaaaaaaaaaaaa",
      avatar: "owl",
      visibility: "public",
      createdAt: T0,
      updatedAt: T1,
    });
    expect(await dao.findByPlayers([GUEST])).toEqual([]);
  });

  it("gives a guest's profile to an account without one, keeping its handle", async () => {
    const dao = await createDao();
    await dao.insert({ playerId: GUEST, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });

    expect(await dao.rename({ from: GUEST, to: RIYA })).toBe(1);
    expect(await dao.rename({ from: GUEST, to: RIYA })).toBe(0);

    expect((await dao.getByHandle("aaaaaaaaaaaaaaaa")).playerId).toBe(RIYA);
    expect(await dao.findByPlayers([GUEST])).toEqual([]);
  });

  it("refuses to give a profile to a player who has one", async () => {
    const dao = await createDao();
    await dao.insert({ playerId: GUEST, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });
    await dao.insert({ playerId: RIYA, handle: "bbbbbbbbbbbbbbbb", createdAt: T0 });

    await expect(dao.rename({ from: GUEST, to: RIYA })).rejects.toThrow(DuplicateKey);
    expect((await dao.getByHandle("aaaaaaaaaaaaaaaa")).playerId).toBe(GUEST);
  });

  it("deletes a player's profile, once", async () => {
    const dao = await createDao();
    await dao.insert({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0 });

    expect(await dao.deleteByPlayer(RIYA)).toBe(1);
    expect(await dao.deleteByPlayer(RIYA)).toBe(0);
    await expect(dao.getByHandle("aaaaaaaaaaaaaaaa")).rejects.toThrow(RangeError);
  });
}
