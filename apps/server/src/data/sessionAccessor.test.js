import { describe, expect, it } from "vitest";
import { createMemoryStoreSessionDao } from "../testing/memoryStoreSessionDao.js";
import { createSessionAccessor } from "./sessionAccessor.js";

const PLAYER = "user_0123456789abcdef01234567";

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
    expect(await sessions.devicesOf(PLAYER)).toEqual([]);
  });

  it("gives the player's signed-in devices as frozen domain models (CC-262)", async () => {
    const sessions = createSessionAccessor({
      sessionDao: {
        listByPlayer: async () => [
          {
            sessionId: "s1",
            sessionVersion: 2,
            signedInAt: 10,
            lastSeenAt: 20,
            device: { id: "d1", browser: "Chrome", system: "Android" },
          },
        ],
      },
    });

    const devices = await sessions.devicesOf(PLAYER);

    expect(devices).toEqual([
      {
        sessionId: "s1",
        sessionVersion: 2,
        signedInAt: 10,
        lastSeenAt: 20,
        deviceId: "d1",
        browser: "Chrome",
        system: "Android",
      },
    ]);
    expect(Object.isFrozen(devices)).toBe(true);
    expect(Object.isFrozen(devices[0])).toBe(true);
  });

  it("removes one session of a player, and says whether there was one (CC-262)", async () => {
    const asked = [];
    const sessions = createSessionAccessor({
      sessionDao: {
        deleteSession: async (which) => {
          asked.push(which);
          return true;
        },
      },
    });

    expect(await sessions.removeSession({ sessionId: "s1", playerId: PLAYER })).toBe(true);
    expect(asked).toEqual([{ sessionId: "s1", playerId: PLAYER }]);
  });

  it("fails fast without its DAO", () => {
    expect(() => createSessionAccessor({})).toThrow(TypeError);
  });
});
