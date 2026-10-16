import { describe, expect, it } from "vitest";
import { createInMemoryRoomDao } from "../persistence/inMemoryRoomDao.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { createRoomAccessor } from "./roomAccessor.js";

const room = { code: "ROOM22", status: "waiting", seats: [{ playerId: "p1" }] };
const setup = () => createRoomAccessor({ roomDao: createInMemoryRoomDao() });

describe("roomAccessor", () => {
  it("returns deeply frozen domain rooms", () => {
    const rooms = setup();

    const created = rooms.create(room);

    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.seats[0])).toBe(true);
    expect(rooms.getByCode("ROOM22")).toEqual(created);
  });

  it("translates a missing room into NotFoundError", () => {
    const rooms = setup();

    expect(() => rooms.getByCode("NOPE22")).toThrow(NotFoundError);
    expect(() => rooms.save({ ...room, code: "NOPE22", version: 1 })).toThrow(NotFoundError);
  });

  it("translates a code collision into ConflictError", () => {
    const rooms = setup();
    rooms.create(room);

    expect(() => rooms.create(room)).toThrow(ConflictError);
  });

  it("translates a concurrent change into ConflictError (no lost updates)", () => {
    const rooms = setup();
    const read = rooms.create(room);
    rooms.save({ ...read, status: "playing" });

    expect(() => rooms.save({ ...read, status: "finished" })).toThrow(/room changed/);
  });

  it("lists and removes rooms", () => {
    const rooms = setup();
    rooms.create(room);

    expect(rooms.listAll().map((r) => r.code)).toEqual(["ROOM22"]);
    rooms.remove("ROOM22");
    expect(rooms.exists("ROOM22")).toBe(false);
  });

  it("passes unexpected storage failures through unchanged", () => {
    const failure = new Error("disk on fire");
    const roomDao = {
      has: () => true,
      insert: () => {
        throw failure;
      },
      update: () => {
        throw failure;
      },
    };
    const rooms = createRoomAccessor({ roomDao });

    expect(() => rooms.create(room)).toThrow(failure);
    expect(() => rooms.save({ ...room, version: 1 })).toThrow(failure);
  });

  it("fails fast without a DAO", () => {
    expect(() => createRoomAccessor({})).toThrow(TypeError);
  });
});
