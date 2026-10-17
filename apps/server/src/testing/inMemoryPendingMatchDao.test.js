import { describe } from "vitest";
import { createInMemoryPendingMatchDao } from "./inMemoryPendingMatchDao.js";
import { runPendingMatchDaoContract } from "./pendingMatchDaoContract.js";

describe("in-memory pending match DAO (test double) honours the pending match DAO contract", () => {
  runPendingMatchDaoContract(async () => createInMemoryPendingMatchDao());
});
