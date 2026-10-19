import { describe, expect, it } from "vitest";
import { VersionConflict } from "../persistence/errors.js";
import { runDailyPuzzleAttemptDaoContract } from "./dailyPuzzleAttemptDaoContract.js";
import { createInMemoryDailyPuzzleAttemptDao } from "./inMemoryDailyPuzzleAttemptDao.js";

describe("in-memory daily puzzle attempt DAO (test double) honours the contract", () => {
  runDailyPuzzleAttemptDaoContract(async () => createInMemoryDailyPuzzleAttemptDao());

  it("meets a conflict on the next change when a test asks for one", async () => {
    const dao = createInMemoryDailyPuzzleAttemptDao();
    const key = { playerId: "p", kind: "chess", day: "2026-10-20" };
    await dao.insert({ ...key, version: 0 });
    dao.failNextUpdate();

    await expect(dao.update({ ...key, version: 0 }, {})).rejects.toThrow(VersionConflict);
    await expect(dao.update({ ...key, version: 0 }, {})).resolves.toMatchObject({ version: 1 });
  });
});
