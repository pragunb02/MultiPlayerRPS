import { describe } from "vitest";
import { createInMemoryLegacyUserDao } from "./inMemoryLegacyUserDao.js";
import { runLegacyUserDaoContract } from "./legacyUserDaoContract.js";

describe("in-memory legacy user DAO honours the legacy user DAO contract", () => {
  runLegacyUserDaoContract(async (seed) => createInMemoryLegacyUserDao([...seed]));
});
