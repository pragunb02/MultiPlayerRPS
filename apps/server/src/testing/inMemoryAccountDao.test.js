import { describe } from "vitest";
import { runAccountDaoContract } from "./accountDaoContract.js";
import { createInMemoryAccountDao } from "./inMemoryAccountDao.js";

describe("in-memory account DAO (test double) honours the account DAO contract", () => {
  runAccountDaoContract(async () => createInMemoryAccountDao());
});
