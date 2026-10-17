import { expect, it } from "vitest";
import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

/** A persistence-level room document for tests: a running game with nested state, a log and a series. */
export function roomDoc(overrides = {}) {
  return {
    code: "ROOM22",
    gameId: "rps",
    options: { bestOf: 3 },
    status: "playing",
    hostId: "guest_a",
    seats: [
      { playerId: "guest_a", displayName: "Alice", connected: true },
      { playerId: "guest_b", displayName: "Bob", connected: false },
    ],
    game: {
      matchId: "00000000-0000-4000-8000-000000000001",
      seed: 42,
      startedAt: T0,
      state: { pending: { guest_a: "rock", guest_b: "" }, rounds: [], score: { guest_a: 0, guest_b: 0 } },
      log: [{ kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: T0 + 1 }],
    },
    series: { games: 1, wins: { guest_a: 1 } },
    createdAt: T0,
    lastActivityAt: T0 + 1,
    dueAt: 0,
    expiresAt: T0 + 60_000,
    ...overrides,
  };
}

/** What a closed room leaves behind. */
export const closedRecord = (overrides = {}) => ({
  code: "ROOM22",
  gameId: "rps",
  reason: "expired",
  closedAt: T0 + 5,
  ...overrides,
});

/**
 * The behaviour every room DAO must have. Run against the MongoDB DAO (integration) and the in-memory test
 * double, so the double can never drift from the real thing (ENGINEERING.md §4 rule 5).
 *
 * @param {(options?: { betweenClosedReads?: () => Promise<void> }) => Promise<ReturnType<typeof import("../persistence/roomDao.js").createRoomDao>>} createDao
 *   `betweenClosedReads` is passed on to the DAO
 */
export function runRoomDaoContract(createDao) {
  it("stores a new room at version 1 and reads it back unchanged", async () => {
    const dao = await createDao();

    const stored = await dao.insert(roomDoc());

    expect(stored).toEqual({ ...roomDoc(), version: 1 });
    expect(await dao.get("ROOM22")).toEqual(stored);
    expect(await dao.has("ROOM22")).toBe(true);
    expect(await dao.has("NOPE22")).toBe(false);
  });

  it("keeps empty objects and lists as they are", async () => {
    const dao = await createDao();
    const doc = roomDoc({ options: {}, game: { ...roomDoc().game, log: [], state: { moves: [], end: {} } } });

    await dao.insert(doc);

    expect(await dao.get("ROOM22")).toEqual({ ...doc, version: 1 });
  });

  it("refuses a second room with the same code", async () => {
    const dao = await createDao();
    await dao.insert(roomDoc());

    await expect(dao.insert(roomDoc({ gameId: "chess" }))).rejects.toThrow(DuplicateKey);
    expect((await dao.get("ROOM22")).gameId).toBe("rps");
  });

  it("returns copies that cannot change what is stored", async () => {
    const dao = await createDao();
    const original = roomDoc();
    const stored = await dao.insert(original);

    original.seats[0].displayName = "changed before";
    stored.seats[0].displayName = "changed after";
    (await dao.get("ROOM22")).seats[0].displayName = "changed on read";

    expect((await dao.get("ROOM22")).seats[0].displayName).toBe("Alice");
  });

  it("updates only from the version that was read, and counts the version up", async () => {
    const dao = await createDao();
    const v1 = await dao.insert(roomDoc());

    const v2 = await dao.update({ doc: { ...v1, status: "finished" }, previous: v1 });

    expect(v2).toEqual({ ...roomDoc(), status: "finished", version: 2 });
    await expect(dao.update({ doc: { ...v1, status: "waiting" }, previous: v1 })).rejects.toThrow(
      VersionConflict,
    );
    expect(await dao.get("ROOM22")).toEqual(v2);
  });

  // Each case changes a stored room one way. Whatever was written, the stored room must read back exactly as the
  // new room, as if it had been replaced whole (CC-182).
  const changes = [
    [
      "a move added to the log",
      (doc) => ({
        ...doc,
        game: {
          ...doc.game,
          log: [
            ...doc.game.log,
            { kind: "move", playerId: "guest_b", move: { choice: "paper" }, at: T0 + 2 },
          ],
        },
      }),
    ],
    [
      "a nested value changed",
      (doc) => ({
        ...doc,
        game: { ...doc.game, state: { ...doc.game.state, pending: { guest_a: "rock", guest_b: "paper" } } },
      }),
    ],
    [
      "a seat changed in place",
      (doc) => ({
        ...doc,
        seats: doc.seats.map((seat) => ({ ...seat, connected: true })),
      }),
    ],
    ["a seat removed", (doc) => ({ ...doc, seats: doc.seats.slice(0, 1) })],
    [
      "a list replaced by a shorter one and the first item changed",
      (doc) => ({
        ...doc,
        game: { ...doc.game, log: [{ kind: "expire", at: T0 + 3 }] },
      }),
    ],
    [
      "a list grown at the end with an earlier item changed",
      (doc) => ({
        ...doc,
        game: {
          ...doc.game,
          log: [
            { kind: "expire", at: T0 + 3 },
            { kind: "expire", at: T0 + 4 },
          ],
        },
      }),
    ],
    ["a field removed", ({ series, ...doc }) => doc],
    ["a field set to undefined", (doc) => ({ ...doc, series: undefined })],
    [
      "a field added",
      (doc) => ({ ...doc, result: { status: "finished", winners: ["guest_a"] }, finishedAt: T0 + 9 }),
    ],
    ["a nested field removed", (doc) => ({ ...doc, series: { games: 1 } })],
    ["a value turned from an object into a list", (doc) => ({ ...doc, options: [] })],
    [
      "a list that was empty filled",
      (doc) => ({ ...doc, game: { ...doc.game, log: [] } }),
      (doc) => ({
        ...doc,
        game: { ...doc.game, log: [{ kind: "expire", at: T0 + 5 }] },
      }),
    ],
    [
      "a whole new game",
      (doc) => ({
        ...doc,
        game: {
          matchId: "00000000-0000-4000-8000-000000000002",
          seed: 7,
          startedAt: T0 + 9,
          state: { rounds: [] },
          log: [],
        },
      }),
    ],
    [
      "keys a database path cannot name",
      (doc) => ({
        ...doc,
        game: { ...doc.game, state: { ...doc.game.state, score: { "guest.a": 1, $b: 2, "": 3 } } },
      }),
    ],
    [
      "a player left a finished room: their seat is gone and the rematch keeps their name (CC-162)",
      (doc) => ({
        ...doc,
        status: "finished",
        finishedAt: T0 + 9,
        rematch: { requestedBy: ["guest_a"], available: true, declinedBy: "" },
      }),
      (doc) => ({
        ...doc,
        seats: doc.seats.slice(0, 1),
        rematch: { requestedBy: [], available: false, declinedBy: "", leftName: "Bob" },
      }),
    ],
    ["the same values in new objects", (doc) => structuredClone(doc)],
    ["nothing at all", (doc) => doc],
  ];

  it.each(changes)("stores the new room exactly after %s", async (_name, first, second = first) => {
    const dao = await createDao();
    const stored = await dao.insert(roomDoc());
    const read = first === second ? stored : await dao.update({ doc: first(stored), previous: stored });
    const next = second(read);

    const updated = await dao.update({ doc: next, previous: read });

    const expected = JSON.parse(JSON.stringify({ ...next, version: read.version + 1 }));
    expect(updated).toEqual(expected);
    expect(await dao.get("ROOM22")).toEqual(expected);
  });

  it("lets only one of two writers that read the same version win", async () => {
    const dao = await createDao();
    const read = await dao.insert(roomDoc());

    const results = await Promise.allSettled([
      dao.update({ doc: { ...read, hostId: "guest_a" }, previous: read }),
      dao.update({ doc: { ...read, hostId: "guest_b" }, previous: read }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected").reason).toBeInstanceOf(VersionConflict);
    expect((await dao.get("ROOM22")).version).toBe(2);
  });

  it("throws for a room that is not there instead of answering nothing", async () => {
    const dao = await createDao();

    await expect(dao.get("NOPE22")).rejects.toThrow(RangeError);
    const missing = { ...roomDoc(), version: 1 };
    await expect(dao.update({ doc: missing, previous: missing })).rejects.toThrow(RangeError);
    await expect(dao.close({ code: "NOPE22", version: 1, record: closedRecord() })).rejects.toThrow(
      RangeError,
    );
  });

  it("closes a room: the room is gone and a record says why", async () => {
    const dao = await createDao();
    const stored = await dao.insert(roomDoc());

    await dao.close({ code: "ROOM22", version: stored.version, record: closedRecord() });

    expect(await dao.has("ROOM22")).toBe(false);
    expect(await dao.hasClosed("ROOM22")).toBe(true);
    expect(await dao.getClosed("ROOM22")).toEqual(closedRecord());
    expect(await dao.list()).toEqual([]);
  });

  it("closes a room only from the version that was read", async () => {
    const dao = await createDao();
    const v1 = await dao.insert(roomDoc());
    await dao.update({ doc: { ...v1, lastActivityAt: T0 + 2 }, previous: v1 });

    await expect(dao.close({ code: "ROOM22", version: 1, record: closedRecord() })).rejects.toThrow(
      VersionConflict,
    );
    expect(await dao.has("ROOM22")).toBe(true);
    expect(await dao.hasClosed("ROOM22")).toBe(false);
  });

  it("keeps the latest record when a code is closed again after being reused", async () => {
    const dao = await createDao();
    const first = await dao.insert(roomDoc());
    await dao.close({ code: "ROOM22", version: first.version, record: closedRecord() });
    const second = await dao.insert(roomDoc({ gameId: "chess" }));

    await dao.close({
      code: "ROOM22",
      version: second.version,
      record: closedRecord({ gameId: "chess", reason: "empty", closedAt: T0 + 9 }),
    });

    expect(await dao.getClosed("ROOM22")).toEqual(
      closedRecord({ gameId: "chess", reason: "empty", closedAt: T0 + 9 }),
    );
  });

  it.each(["hasClosed", "getClosed"])(
    "%s finds a close that finishes between its two reads, so the room never reads as never there",
    async (lookup) => {
      // Another process closes the room while this one is looking it up (CC-204).
      let closeNow = async () => {};
      const dao = await createDao({ betweenClosedReads: () => closeNow() });
      const stored = await dao.insert(roomDoc());
      closeNow = async () => {
        closeNow = async () => {};
        await dao.close({ code: "ROOM22", version: stored.version, record: closedRecord() });
      };

      const found = await dao[lookup]("ROOM22");

      expect(found).toEqual(lookup === "hasClosed" ? true : closedRecord());
    },
  );

  it("throws for a closed record that is not there", async () => {
    const dao = await createDao();

    expect(await dao.hasClosed("NOPE22")).toBe(false);
    await expect(dao.getClosed("NOPE22")).rejects.toThrow(RangeError);
  });

  it("forgets closed records older than a given time, and says how many", async () => {
    const dao = await createDao();
    for (const [code, closedAt] of [
      ["OLD222", T0],
      ["EDGE22", T0 + 10],
      ["NEW222", T0 + 20],
    ]) {
      const stored = await dao.insert(roomDoc({ code }));
      await dao.close({ code, version: stored.version, record: closedRecord({ code, closedAt }) });
    }

    const forgotten = await dao.deleteClosedBefore(T0 + 10);

    expect(forgotten).toBe(1);
    expect(await dao.hasClosed("OLD222")).toBe(false);
    expect(await dao.hasClosed("EDGE22")).toBe(true);
    expect(await dao.hasClosed("NEW222")).toBe(true);
  });

  it("lists every room, the rooms a player sits in, and nothing for strangers", async () => {
    const dao = await createDao();
    await dao.insert(roomDoc());
    await dao.insert(
      roomDoc({ code: "ROOM33", seats: [{ playerId: "guest_c", displayName: "Carol", connected: true }] }),
    );

    expect((await dao.list()).map((doc) => doc.code).sort()).toEqual(["ROOM22", "ROOM33"]);
    expect((await dao.listBySeat("guest_b")).map((doc) => doc.code)).toEqual(["ROOM22"]);
    expect((await dao.listBySeat("guest_c")).map((doc) => doc.code)).toEqual(["ROOM33"]);
    expect(await dao.listBySeat("guest_nobody")).toEqual([]);
  });

  it("lists the rooms whose game deadline has come, never those without one", async () => {
    const dao = await createDao();
    await dao.insert(roomDoc({ code: "NONE22", dueAt: 0 }));
    await dao.insert(roomDoc({ code: "PAST22", dueAt: T0 - 1 }));
    await dao.insert(roomDoc({ code: "NOW222", dueAt: T0 }));
    await dao.insert(roomDoc({ code: "LATE22", dueAt: T0 + 1 }));

    const due = await dao.listDue(T0);

    expect(due.map((doc) => doc.code).sort()).toEqual(["NOW222", "PAST22"]);
  });

  it("lists the rooms whose lifetime has ended", async () => {
    const dao = await createDao();
    await dao.insert(roomDoc({ code: "PAST22", expiresAt: T0 - 1 }));
    await dao.insert(roomDoc({ code: "NOW222", expiresAt: T0 }));
    await dao.insert(roomDoc({ code: "LATE22", expiresAt: T0 + 1 }));

    const expired = await dao.listExpired(T0);

    expect(expired.map((doc) => doc.code).sort()).toEqual(["NOW222", "PAST22"]);
  });

  it("returns copies from lists too", async () => {
    const dao = await createDao();
    await dao.insert(roomDoc());

    (await dao.list())[0].seats[0].displayName = "changed";

    expect((await dao.get("ROOM22")).seats[0].displayName).toBe("Alice");
  });
}
