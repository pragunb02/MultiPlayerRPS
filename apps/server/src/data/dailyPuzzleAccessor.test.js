import { describe, expect, it } from "vitest";
import { createInMemoryDailyPuzzleAttemptDao } from "../testing/inMemoryDailyPuzzleAttemptDao.js";
import { ConflictError } from "../utils/errors.js";
import { createDailyPuzzleAccessor } from "./dailyPuzzleAccessor.js";

const T0 = Date.UTC(2026, 9, 20, 6);
const RIYA = "user_0123456789abcdef01234567";
const PUZZLE = { id: "0000D", fen: "x", moves: ["a", "b"], rating: 1500, themes: ["fork"] };

const attempt = (changes = {}) => ({
  playerId: RIYA,
  kind: "chess",
  day: "2026-10-20",
  puzzleId: "0000D",
  status: "playing",
  found: [],
  marks: [0],
  mistakes: 0,
  hints: [0],
  streak: 0,
  best: 0,
  version: 0,
  startedAt: T0,
  updatedAt: T0,
  finishedAt: 0,
  ...changes,
});

function setup() {
  const attemptDao = createInMemoryDailyPuzzleAttemptDao();
  const accessor = createDailyPuzzleAccessor({ attemptDao, catalogues: { chess: [PUZZLE] } });
  return { attemptDao, accessor };
}

describe("the daily puzzle accessor", () => {
  it("gives each kind's puzzles, frozen, and refuses an unknown kind", () => {
    const { accessor } = setup();

    expect(accessor.puzzlesOf("chess")).toEqual([PUZZLE]);
    expect(Object.isFrozen(accessor.puzzlesOf("chess")[0].moves)).toBe(true);
    expect(() => accessor.puzzlesOf("sudoku")).toThrow(RangeError);
  });

  it("starts an attempt and reads it back with times in milliseconds", async () => {
    const { accessor } = setup();

    const { created, attempt: started } = await accessor.add(attempt());

    expect(created).toBe(true);
    expect(started).toEqual(attempt());
    expect(Object.isFrozen(started.marks)).toBe(true);
    expect(await accessor.findDay({ playerId: RIYA, kind: "chess", day: "2026-10-20" })).toEqual([attempt()]);
  });

  it("answers the attempt the player already has when one is added twice, and says it made none", async () => {
    const { accessor } = setup();
    await accessor.add(attempt({ hints: [1] }));

    expect(await accessor.add(attempt())).toMatchObject({ created: false, attempt: { hints: [1] } });
  });

  it("passes other storage failures through when starting", async () => {
    const attemptDao = {
      ...createInMemoryDailyPuzzleAttemptDao(),
      insert: async () => Promise.reject(new Error("down")),
    };
    const accessor = createDailyPuzzleAccessor({ attemptDao, catalogues: {} });

    await expect(accessor.add(attempt())).rejects.toThrow("down");
  });

  it("saves a change at the version it was read at and keeps the finish time", async () => {
    const { accessor } = setup();
    const { attempt: started } = await accessor.add(attempt());

    const saved = await accessor.save({ ...started, status: "solved", finishedAt: T0 + 5000 });

    expect(saved).toMatchObject({ status: "solved", finishedAt: T0 + 5000, version: 1 });
    const [latest] = await accessor.findLatestFinished({
      playerId: RIYA,
      kind: "chess",
      beforeDay: "2026-10-21",
    });
    expect(latest).toEqual(saved);
  });

  it("calls a change made in between a conflict", async () => {
    const { accessor, attemptDao } = setup();
    const { attempt: started } = await accessor.add(attempt());
    attemptDao.failNextUpdate();

    const error = await accessor.save({ ...started, hints: [1] }).catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual({ reason: "changed" });
  });

  it("passes other storage failures through when saving", async () => {
    const attemptDao = {
      ...createInMemoryDailyPuzzleAttemptDao(),
      update: async () => Promise.reject(new Error("down")),
    };
    const accessor = createDailyPuzzleAccessor({ attemptDao, catalogues: {} });

    await expect(accessor.save(attempt())).rejects.toThrow("down");
  });

  it("passes other storage failures through when moving a day", async () => {
    const attemptDao = {
      ...createInMemoryDailyPuzzleAttemptDao(),
      reassign: async () => Promise.reject(new Error("down")),
    };
    const accessor = createDailyPuzzleAccessor({ attemptDao, catalogues: {} });

    await expect(accessor.reassign({ from: "a", to: "b", kind: "chess", day: "2026-10-20" })).rejects.toThrow(
      "down",
    );
  });

  it("lists, moves and removes a player's days", async () => {
    const { accessor } = setup();
    const GUEST = "guest_00000000-0000-4000-8000-000000000001";
    await accessor.add(attempt({ playerId: GUEST, day: "2026-10-19" }));
    await accessor.add(attempt({ playerId: GUEST }));
    await accessor.add(attempt({ playerId: GUEST, day: "2026-10-18" }));
    await accessor.add(attempt({ day: "2026-10-18" }));

    expect(await accessor.reassign({ from: GUEST, to: RIYA, kind: "chess", day: "2026-10-19" })).toEqual({
      moved: 1,
      collided: false,
    });
    expect(await accessor.reassign({ from: GUEST, to: RIYA, kind: "chess", day: "2026-10-18" })).toEqual({
      moved: 0,
      collided: true,
    });
    expect(await accessor.removeDay({ playerId: GUEST, kind: "chess", day: "2026-10-18" })).toBe(1);
    expect(await accessor.removeDay({ playerId: GUEST, kind: "chess", day: "2026-10-20", extra: 1 })).toBe(1);

    expect((await accessor.listByPlayer(RIYA)).map(({ day }) => day)).toEqual(["2026-10-18", "2026-10-19"]);
    expect(await accessor.removePlayer(RIYA)).toBe(2);
    expect(await accessor.listByPlayer(RIYA)).toEqual([]);
  });
});
