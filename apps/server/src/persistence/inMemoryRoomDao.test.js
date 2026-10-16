import { describe, expect, it } from "vitest";
import { createInMemoryRoomDao, DuplicateKey, VersionConflict } from "./inMemoryRoomDao.js";

const doc = (overrides = {}) => ({
  code: "ROOM22",
  status: "waiting",
  seats: [{ playerId: "p1" }],
  ...overrides,
});

describe("inMemoryRoomDao", () => {
  it("stores new documents at version 1 and reads them back", () => {
    const dao = createInMemoryRoomDao();

    expect(dao.insert(doc())).toEqual({ ...doc(), version: 1 });
    expect(dao.get("ROOM22")).toEqual({ ...doc(), version: 1 });
    expect(dao.has("ROOM22")).toBe(true);
  });

  it("refuses duplicate codes", () => {
    const dao = createInMemoryRoomDao();
    dao.insert(doc());

    expect(() => dao.insert(doc())).toThrow(DuplicateKey);
  });

  it("isolates stored data from callers (copies in and out)", () => {
    const dao = createInMemoryRoomDao();
    const original = doc();
    dao.insert(original);

    original.seats[0].playerId = "mutated";
    dao.get("ROOM22").seats[0].playerId = "mutated too";

    expect(dao.get("ROOM22").seats[0].playerId).toBe("p1");
  });

  it("updates only from the current version, incrementing it", () => {
    const dao = createInMemoryRoomDao();
    const v1 = dao.insert(doc());

    const v2 = dao.update({ ...v1, status: "playing" });

    expect(v2).toEqual(expect.objectContaining({ status: "playing", version: 2 }));
    expect(() => dao.update({ ...v1, status: "finished" })).toThrow(VersionConflict);
  });

  it("throws for missing documents instead of returning nothing", () => {
    const dao = createInMemoryRoomDao();

    expect(() => dao.get("NOPE22")).toThrow(RangeError);
    expect(() => dao.update({ ...doc(), version: 1 })).toThrow(RangeError);
  });

  it("deletes and lists", () => {
    const dao = createInMemoryRoomDao();
    dao.insert(doc());
    dao.insert(doc({ code: "ROOM33" }));

    dao.delete("ROOM22");

    expect(dao.list().map((d) => d.code)).toEqual(["ROOM33"]);
  });
});
