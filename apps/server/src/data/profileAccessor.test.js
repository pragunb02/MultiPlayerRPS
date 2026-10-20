import { describe, expect, it } from "vitest";
import { createInMemoryProfileDao } from "../testing/inMemoryProfileDao.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { createProfileAccessor } from "./profileAccessor.js";

const RIYA = "user_0123456789abcdef01234567";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const T0 = Date.UTC(2026, 9, 20, 12);

/** Handles from a list, so a test can make two of them clash. */
const handles = (...list) => {
  const queue = [...list];
  return () => queue.shift() ?? "zzzzzzzzzzzzzzzz";
};

function setup({
  dao = createInMemoryProfileDao(),
  newHandle = handles("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"),
} = {}) {
  return { dao, profiles: createProfileAccessor({ profileDao: dao, newHandle }) };
}

describe("profileAccessor (CC-034)", () => {
  it("makes a profile with a new handle the first time, and answers the same one after", async () => {
    const { profiles } = setup();

    const first = await profiles.getOrCreate({ playerId: RIYA, at: T0 });
    const again = await profiles.getOrCreate({ playerId: RIYA, at: T0 + 1 });

    expect(first).toEqual({ playerId: RIYA, handle: "aaaaaaaaaaaaaaaa", createdAt: T0, updatedAt: T0 });
    expect(again).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("tries a new handle when the first one is taken", async () => {
    const { profiles } = setup({
      newHandle: handles("aaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaa", "cccccccccccccccc"),
    });
    await profiles.getOrCreate({ playerId: GUEST, at: T0 });

    expect((await profiles.getOrCreate({ playerId: RIYA, at: T0 })).handle).toBe("cccccccccccccccc");
  });

  it("gives up after three clashes in a row, which only a broken generator makes", async () => {
    const { profiles } = setup({ newHandle: () => "aaaaaaaaaaaaaaaa" });
    await profiles.getOrCreate({ playerId: GUEST, at: T0 });

    await expect(profiles.getOrCreate({ playerId: RIYA, at: T0 })).rejects.toThrow(/after 3 attempts/);
  });

  it("reads the profile someone else made a moment ago instead of making a second", async () => {
    const dao = createInMemoryProfileDao();
    let raced = false;
    const racing = {
      ...dao,
      async findByPlayers(ids) {
        const found = await dao.findByPlayers(ids);
        if (!raced) {
          raced = true;
          await dao.insert({ playerId: RIYA, handle: "rrrrrrrrrrrrrrrr", createdAt: new Date(T0) });
        }
        return found;
      },
    };
    const { profiles } = setup({ dao: racing });

    expect((await profiles.getOrCreate({ playerId: RIYA, at: T0 })).handle).toBe("rrrrrrrrrrrrrrrr");
  });

  it("passes other storage failures through", async () => {
    const dao = createInMemoryProfileDao();
    const broken = { ...dao, insert: async () => Promise.reject(new Error("disk full")) };
    const { profiles } = setup({ dao: broken });

    await expect(profiles.getOrCreate({ playerId: RIYA, at: T0 })).rejects.toThrow("disk full");
  });

  it("finds only the profiles that exist, and makes the missing ones on request", async () => {
    const { profiles } = setup();
    await profiles.getOrCreate({ playerId: RIYA, at: T0 });

    expect([...(await profiles.findMany([RIYA, GUEST])).keys()]).toEqual([RIYA]);
    expect(await profiles.findMany([])).toEqual(new Map());
    const all = await profiles.getOrCreateMany({ playerIds: [RIYA, GUEST, GUEST], at: T0 });
    expect([...all.keys()].sort()).toEqual([GUEST, RIYA].sort());
    expect(all.get(GUEST).handle).toBe("bbbbbbbbbbbbbbbb");
  });

  it("reads a profile by handle, and not found for any other handle", async () => {
    const { profiles } = setup();
    await profiles.getOrCreate({ playerId: RIYA, at: T0 });

    expect((await profiles.getByHandle("aaaaaaaaaaaaaaaa")).playerId).toBe(RIYA);
    await expect(profiles.getByHandle("bbbbbbbbbbbbbbbb")).rejects.toThrow(NotFoundError);
  });

  it("passes a broken handle read through", async () => {
    const dao = createInMemoryProfileDao();
    const { profiles } = setup({
      dao: { ...dao, getByHandle: async () => Promise.reject(new Error("down")) },
    });

    await expect(profiles.getByHandle("aaaaaaaaaaaaaaaa")).rejects.toThrow("down");
  });

  it("sets the avatar and the visibility, making the profile first", async () => {
    const { profiles } = setup();

    await profiles.update({ playerId: RIYA, set: { avatar: "owl" }, at: T0 });
    const updated = await profiles.update({ playerId: RIYA, set: { visibility: "public" }, at: T0 + 5 });

    expect(updated).toEqual({
      playerId: RIYA,
      handle: "aaaaaaaaaaaaaaaa",
      avatar: "owl",
      visibility: "public",
      createdAt: T0,
      updatedAt: T0 + 5,
    });
  });

  it("moves a profile to a player without one, and refuses one who has one", async () => {
    const { profiles } = setup();
    await profiles.getOrCreate({ playerId: GUEST, at: T0 });

    expect(await profiles.rename({ from: GUEST, to: RIYA })).toBe(true);
    expect(await profiles.rename({ from: GUEST, to: RIYA })).toBe(false);
    await profiles.getOrCreate({ playerId: GUEST, at: T0 });
    await expect(profiles.rename({ from: GUEST, to: RIYA })).rejects.toThrow(ConflictError);
  });

  it("passes any other storage failure on unchanged when moving a profile", async () => {
    const failure = new Error("the store is down");
    const dao = { ...createInMemoryProfileDao(), rename: async () => Promise.reject(failure) };
    const { profiles } = setup({ dao });

    await expect(profiles.rename({ from: GUEST, to: RIYA })).rejects.toBe(failure);
  });

  it("removes a profile", async () => {
    const { profiles } = setup();
    await profiles.getOrCreate({ playerId: RIYA, at: T0 });

    expect(await profiles.remove(RIYA)).toBe(1);
    expect(await profiles.findMany([RIYA])).toEqual(new Map());
  });
});
