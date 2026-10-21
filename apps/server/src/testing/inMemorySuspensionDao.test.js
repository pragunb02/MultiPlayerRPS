import { describe } from "vitest";
import { createInMemorySuspensionDao } from "./inMemorySuspensionDao.js";
import { runSuspensionDaoContract } from "./suspensionDaoContract.js";

describe("in-memory suspension DAO (test double) honours the suspension DAO contract", () => {
  runSuspensionDaoContract(async () => createInMemorySuspensionDao());
});
