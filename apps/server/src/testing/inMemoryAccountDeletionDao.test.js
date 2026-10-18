import { describe } from "vitest";
import { runAccountDeletionDaoContract } from "./accountDeletionDaoContract.js";
import { createInMemoryAccountDeletionDao } from "./inMemoryAccountDeletionDao.js";

describe("in-memory account deletion DAO (test double) honours the account deletion DAO contract", () => {
  runAccountDeletionDaoContract(async () => createInMemoryAccountDeletionDao());
});
