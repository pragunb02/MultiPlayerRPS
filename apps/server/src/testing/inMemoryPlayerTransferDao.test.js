import { describe } from "vitest";
import { createInMemoryPlayerTransferDao } from "./inMemoryPlayerTransferDao.js";
import { runPlayerTransferDaoContract } from "./playerTransferDaoContract.js";

describe("in-memory player transfer DAO (test double) honours the player transfer DAO contract", () => {
  runPlayerTransferDaoContract(async () => createInMemoryPlayerTransferDao());
});
