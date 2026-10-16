import { describe } from "vitest";
import { createInMemoryProgressDao } from "./inMemoryProgressDao.js";
import { runProgressDaoContract } from "./progressDaoContract.js";

describe("in-memory progress DAO (test double) honours the progress DAO contract", () => {
  runProgressDaoContract(async () => createInMemoryProgressDao());
});
