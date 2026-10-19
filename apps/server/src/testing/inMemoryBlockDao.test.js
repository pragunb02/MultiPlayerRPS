import { describe } from "vitest";
import { runBlockDaoContract } from "./blockDaoContract.js";
import { createInMemoryBlockDao } from "./inMemoryBlockDao.js";

describe("in-memory block DAO (test double) honours the block DAO contract", () => {
  runBlockDaoContract(async () => createInMemoryBlockDao());
});
