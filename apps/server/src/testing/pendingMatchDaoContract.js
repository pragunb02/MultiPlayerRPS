import { expect, it } from "vitest";

const T0 = new Date(Date.UTC(2026, 9, 18, 12));
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);

/** A finished game as the outbox keeps it: the match to record, as plain JSON. */
const entry = (matchId, overrides = {}) => ({
  matchId,
  match: {
    matchId,
    roomCode: "ROOM22",
    gameId: "rps",
    players: [{ playerId: "guest_a", displayName: "Alice" }],
    log: [{ kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: 1 }],
    result: { result: "win", winners: ["guest_a"], reason: "best-of-1" },
    startedAt: 1,
    endedAt: 2,
  },
  createdAt: T0,
  nextAttemptAt: T0,
  ...overrides,
});

/**
 * Behaviour every pending match DAO must have (the MongoDB DAO and the in-memory double), so the double used by
 * the fast tests can never drift from the real store (CC-111).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/pendingMatchDao.js").createPendingMatchDao>>} createDao
 */
export function runPendingMatchDaoContract(createDao) {
  it("adds a finished game once, as pending with nothing done", async () => {
    const dao = await createDao();

    const first = await dao.insertIfAbsent(entry("m1"));
    const again = await dao.insertIfAbsent(entry("m1", { createdAt: at(5) }));

    expect([first, again]).toEqual([true, false]);
    expect(await dao.get("m1")).toEqual({
      ...entry("m1"),
      status: "pending",
      done: [],
      attempts: 0,
    });
  });

  it("throws for a game it does not have", async () => {
    const dao = await createDao();

    await expect(dao.get("nope")).rejects.toThrow(RangeError);
  });

  it("lists pending games whose next attempt is due, the longest waiting first", async () => {
    const dao = await createDao();
    await dao.insertIfAbsent(entry("later", { nextAttemptAt: at(10) }));
    await dao.insertIfAbsent(entry("second", { nextAttemptAt: at(2) }));
    await dao.insertIfAbsent(entry("first", { nextAttemptAt: at(1) }));
    await dao.insertIfAbsent(entry("done", { nextAttemptAt: at(0) }));
    await dao.markDone({ matchId: "done", doneAt: at(0), expiresAt: at(100) });

    const due = await dao.listDue({ now: at(5), limit: 10 });
    const one = await dao.listDue({ now: at(5), limit: 1 });

    expect(due.map((doc) => doc.matchId)).toEqual(["first", "second"]);
    expect(one.map((doc) => doc.matchId)).toEqual(["first"]);
  });

  it("remembers each step done, once", async () => {
    const dao = await createDao();
    await dao.insertIfAbsent(entry("m1"));

    await dao.addDone({ matchId: "m1", step: "record match" });
    await dao.addDone({ matchId: "m1", step: "judge" });
    await dao.addDone({ matchId: "m1", step: "record match" });

    expect((await dao.get("m1")).done).toEqual(["record match", "judge"]);
  });

  it("records a failed attempt, and a failure for good", async () => {
    const dao = await createDao();
    await dao.insertIfAbsent(entry("m1"));

    await dao.recordFailure({
      matchId: "m1",
      status: "pending",
      attempts: 1,
      nextAttemptAt: at(2),
      lastError: { step: "apply progression", message: "db down" },
    });
    const retrying = await dao.get("m1");
    await dao.recordFailure({
      matchId: "m1",
      status: "failed",
      attempts: 2,
      nextAttemptAt: at(2),
      lastError: { step: "apply progression", message: "still down" },
    });

    expect(retrying).toEqual(
      expect.objectContaining({ status: "pending", attempts: 1, nextAttemptAt: at(2) }),
    );
    expect(await dao.get("m1")).toEqual(
      expect.objectContaining({
        status: "failed",
        attempts: 2,
        lastError: { step: "apply progression", message: "still down" },
      }),
    );
    expect(await dao.listDue({ now: at(10), limit: 10 })).toEqual([]);
  });

  it("marks a game done with the time it may be forgotten", async () => {
    const dao = await createDao();
    await dao.insertIfAbsent(entry("m1"));

    await dao.markDone({ matchId: "m1", doneAt: at(3), expiresAt: at(100) });

    expect(await dao.get("m1")).toEqual(
      expect.objectContaining({ status: "done", doneAt: at(3), expiresAt: at(100) }),
    );
  });

  it("keeps the stored game apart from the one it was given", async () => {
    const dao = await createDao();
    const given = entry("m1");

    await dao.insertIfAbsent(given);
    given.match.log.push({ kind: "move" });
    const read = await dao.get("m1");
    read.match.log.push({ kind: "move" });

    expect((await dao.get("m1")).match.log).toHaveLength(1);
  });
}
