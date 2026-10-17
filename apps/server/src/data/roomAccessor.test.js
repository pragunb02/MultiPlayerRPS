import { describe, expect, it } from "vitest";
import { createInMemoryRoomDao } from "../testing/inMemoryRoomDao.js";
import { ConcurrentChangeError, ConflictError, NotFoundError } from "../utils/errors.js";
import { createRoomAccessor } from "./roomAccessor.js";

const room = (overrides = {}) => ({
  code: "ROOM22",
  gameId: "rps",
  status: "waiting",
  seats: [{ playerId: "p1" }],
  dueAt: 0,
  expiresAt: 100,
  ...overrides,
});
const setup = () => createRoomAccessor({ roomDao: createInMemoryRoomDao() });

describe("roomAccessor", () => {
  it("returns deeply frozen domain rooms", async () => {
    const rooms = setup();

    const created = await rooms.create(room());

    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.seats[0])).toBe(true);
    expect(await rooms.getByCode("ROOM22")).toEqual(created);
    expect(await rooms.exists("ROOM22")).toBe(true);
  });

  it("translates a missing room into NotFoundError", async () => {
    const rooms = setup();

    await expect(rooms.getByCode("NOPE22")).rejects.toThrow(NotFoundError);
    const missing = room({ code: "NOPE22", version: 1 });
    await expect(rooms.save({ room: missing, previous: missing })).rejects.toThrow(NotFoundError);
    await expect(
      rooms.close({ room: room({ code: "NOPE22", version: 1 }), reason: "expired", closedAt: 5 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("translates a code collision into ConflictError", async () => {
    const rooms = setup();
    await rooms.create(room());

    await expect(rooms.create(room())).rejects.toThrow(ConflictError);
  });

  it("translates a concurrent change into ConcurrentChangeError, so no update is lost", async () => {
    const rooms = setup();
    const read = await rooms.create(room());
    await rooms.save({ room: { ...read, status: "playing" }, previous: read });

    await expect(rooms.save({ room: { ...read, status: "finished" }, previous: read })).rejects.toThrow(
      ConcurrentChangeError,
    );
    await expect(rooms.close({ room: read, reason: "expired", closedAt: 5 })).rejects.toThrow(
      ConcurrentChangeError,
    );
  });

  it("closes a room and keeps a frozen record of why", async () => {
    const rooms = setup();
    const created = await rooms.create(room());

    await rooms.close({ room: created, reason: "expired", closedAt: 5 });

    expect(await rooms.exists("ROOM22")).toBe(false);
    expect(await rooms.wasClosed("ROOM22")).toBe(true);
    const record = await rooms.getClosed("ROOM22");
    expect(record).toEqual({ code: "ROOM22", gameId: "rps", reason: "expired", closedAt: 5 });
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("translates a missing closed record into NotFoundError", async () => {
    const rooms = setup();

    expect(await rooms.wasClosed("NOPE22")).toBe(false);
    await expect(rooms.getClosed("NOPE22")).rejects.toThrow(NotFoundError);
  });

  it("forgets old closed records", async () => {
    const rooms = setup();
    await rooms.close({ room: await rooms.create(room()), reason: "empty", closedAt: 5 });

    expect(await rooms.forgetClosedBefore(6)).toBe(1);
    expect(await rooms.wasClosed("ROOM22")).toBe(false);
  });

  it("lists all rooms, by seat, by deadline and by end of lifetime, as frozen lists", async () => {
    const rooms = setup();
    await rooms.create(room());
    await rooms.create(room({ code: "ROOM33", seats: [{ playerId: "p2" }], dueAt: 7, expiresAt: 300 }));

    const all = await rooms.listAll();

    expect(all.map((r) => r.code)).toEqual(["ROOM22", "ROOM33"]);
    expect(Object.isFrozen(all)).toBe(true);
    expect((await rooms.listBySeat("p2")).map((r) => r.code)).toEqual(["ROOM33"]);
    expect((await rooms.listDue(7)).map((r) => r.code)).toEqual(["ROOM33"]);
    expect((await rooms.listExpired(100)).map((r) => r.code)).toEqual(["ROOM22"]);
  });

  it("counts open rooms, in all and per status with every status present", async () => {
    const rooms = setup();
    await rooms.create(room());
    await rooms.create(room({ code: "ROOM33", status: "playing" }));

    const perStatus = await rooms.countByStatus();

    expect(await rooms.countOpen()).toBe(2);
    expect(perStatus).toEqual({ waiting: 1, playing: 1, finished: 0 });
    expect(Object.isFrozen(perStatus)).toBe(true);
  });

  it("passes unexpected storage failures through unchanged", async () => {
    const failure = new Error("disk on fire");
    const fail = async () => {
      throw failure;
    };
    const rooms = createRoomAccessor({ roomDao: { get: fail, insert: fail, update: fail, getClosed: fail } });

    await expect(rooms.getByCode("ROOM22")).rejects.toThrow(failure);
    await expect(rooms.getClosed("ROOM22")).rejects.toThrow(failure);
    await expect(rooms.create(room())).rejects.toThrow(failure);
    await expect(rooms.save({ room: room({ version: 1 }), previous: room({ version: 1 }) })).rejects.toThrow(
      failure,
    );
  });

  it("fails fast without a DAO", () => {
    expect(() => createRoomAccessor({})).toThrow(TypeError);
  });
});
