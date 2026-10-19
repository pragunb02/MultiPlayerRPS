import { expect, it } from "vitest";
import { DuplicateKey, VersionConflict } from "../persistence/errors.js";

const T0 = new Date(Date.UTC(2026, 9, 20, 6));
const RIYA = "user_0123456789abcdef01234567";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

/** One day's attempt as the accessor writes it. Only the fields a test cares about change. */
const attempt = ({
  playerId = RIYA,
  kind = "chess",
  day = "2026-10-20",
  status = "playing",
  ...rest
} = {}) => ({
  playerId,
  kind,
  day,
  puzzleId: "0000D",
  status,
  found: [],
  marks: [0, 0],
  mistakes: 0,
  hints: [0, 0],
  streak: 0,
  best: 0,
  version: 0,
  startedAt: T0,
  updatedAt: T0,
  ...rest,
});

/**
 * Behaviour every daily puzzle attempt DAO must have (CC-144): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/dailyPuzzleAttemptDao.js").createDailyPuzzleAttemptDao>>} createDao
 */
export function runDailyPuzzleAttemptDaoContract(createDao) {
  it("stores an attempt and finds it by player, kind and day", async () => {
    const dao = await createDao();
    const stored = attempt();

    await dao.insert(stored);

    expect(await dao.findDay({ playerId: RIYA, kind: "chess", day: "2026-10-20" })).toEqual([stored]);
    expect(await dao.findDay({ playerId: RIYA, kind: "chess", day: "2026-10-21" })).toEqual([]);
    expect(await dao.findDay({ playerId: GUEST, kind: "chess", day: "2026-10-20" })).toEqual([]);
  });

  it("keeps one attempt per player, kind and day", async () => {
    const dao = await createDao();
    await dao.insert(attempt());

    await expect(dao.insert(attempt())).rejects.toThrow(DuplicateKey);
    await expect(dao.insert(attempt({ day: "2026-10-21" }))).resolves.toBeUndefined();
    await expect(dao.insert(attempt({ kind: "uttt" }))).resolves.toBeUndefined();
  });

  it("changes an attempt only at the version it was read at, and counts the version up", async () => {
    const dao = await createDao();
    await dao.insert(attempt());
    const key = { playerId: RIYA, kind: "chess", day: "2026-10-20" };

    const changed = await dao.update({ ...key, version: 0 }, { mistakes: 1, marks: [1, 0], updatedAt: T0 });

    expect(changed).toMatchObject({ mistakes: 1, marks: [1, 0], version: 1 });
    await expect(dao.update({ ...key, version: 0 }, { mistakes: 2 })).rejects.toThrow(VersionConflict);
    expect((await dao.findDay(key))[0]).toMatchObject({ mistakes: 1, version: 1 });
  });

  it("finds the latest finished attempt before a day, skipping one still being played", async () => {
    const dao = await createDao();
    await dao.insert(attempt({ day: "2026-10-17", status: "solved", streak: 1, best: 4 }));
    await dao.insert(attempt({ day: "2026-10-18", status: "failed", best: 4 }));
    await dao.insert(attempt({ day: "2026-10-19", status: "playing" }));
    await dao.insert(attempt({ day: "2026-10-20", status: "solved", streak: 1, best: 4 }));
    await dao.insert(attempt({ day: "2026-10-18", status: "solved", kind: "uttt" }));

    const latest = await dao.findLatestFinished({ playerId: RIYA, kind: "chess", beforeDay: "2026-10-20" });

    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ day: "2026-10-18", status: "failed" });
    expect(await dao.findLatestFinished({ playerId: RIYA, kind: "chess", beforeDay: "2026-10-17" })).toEqual(
      [],
    );
  });

  it("lists a player's attempts by kind and day, oldest first", async () => {
    const dao = await createDao();
    await dao.insert(attempt({ day: "2026-10-20" }));
    await dao.insert(attempt({ day: "2026-10-18", kind: "uttt" }));
    await dao.insert(attempt({ day: "2026-10-19" }));
    await dao.insert(attempt({ playerId: GUEST }));

    const listed = await dao.listByPlayer(RIYA);

    expect(listed.map(({ kind, day }) => `${kind} ${day}`)).toEqual([
      "chess 2026-10-19",
      "chess 2026-10-20",
      "uttt 2026-10-18",
    ]);
  });

  it("gives one day of one player to another, and deletes one day", async () => {
    const dao = await createDao();
    await dao.insert(attempt({ playerId: GUEST, day: "2026-10-19" }));
    await dao.insert(attempt({ playerId: GUEST, day: "2026-10-20" }));

    expect(await dao.reassign({ from: GUEST, to: RIYA, kind: "chess", day: "2026-10-19" })).toBe(1);
    expect(await dao.reassign({ from: GUEST, to: RIYA, kind: "chess", day: "2026-10-19" })).toBe(0);
    expect(await dao.deleteDay({ playerId: GUEST, kind: "chess", day: "2026-10-20" })).toBe(1);
    expect(await dao.deleteDay({ playerId: GUEST, kind: "chess", day: "2026-10-20" })).toBe(0);

    expect((await dao.listByPlayer(RIYA)).map(({ day }) => day)).toEqual(["2026-10-19"]);
    expect(await dao.listByPlayer(GUEST)).toEqual([]);
  });

  it("deletes every attempt of a player and nobody else's", async () => {
    const dao = await createDao();
    await dao.insert(attempt({ day: "2026-10-19" }));
    await dao.insert(attempt({ day: "2026-10-20" }));
    await dao.insert(attempt({ playerId: GUEST }));

    expect(await dao.deleteByPlayer(RIYA)).toBe(2);
    expect(await dao.deleteByPlayer(RIYA)).toBe(0);
    expect(await dao.listByPlayer(GUEST)).toHaveLength(1);
  });

  it("keeps the time an attempt finished", async () => {
    const dao = await createDao();
    const finishedAt = new Date(T0.getTime() + 60_000);
    await dao.insert(attempt());

    await dao.update(
      { playerId: RIYA, kind: "chess", day: "2026-10-20", version: 0 },
      { status: "solved", finishedAt },
    );

    expect((await dao.listByPlayer(RIYA))[0]).toMatchObject({ status: "solved", finishedAt });
  });
}
