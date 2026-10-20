import { describe } from "vitest";
import { createInMemoryProfileDao } from "./inMemoryProfileDao.js";
import { runProfileDaoContract } from "./profileDaoContract.js";

describe("in-memory profile DAO (test double) honours the profile DAO contract", () => {
  runProfileDaoContract(async () => createInMemoryProfileDao());
});
