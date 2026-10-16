import { describe } from "vitest";
import { createInMemoryMatchDao } from "./inMemoryMatchDao.js";
import { runMatchDaoContract } from "./matchDaoContract.js";

describe("in-memory match DAO (test double) honours the match DAO contract", () => {
  runMatchDaoContract(async () => createInMemoryMatchDao());
});
