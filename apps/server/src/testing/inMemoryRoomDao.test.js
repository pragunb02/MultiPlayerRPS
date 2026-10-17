import { describe } from "vitest";
import { createInMemoryRoomDao } from "./inMemoryRoomDao.js";
import { runRoomDaoContract } from "./roomDaoContract.js";

describe("in-memory room DAO (test double) honours the room DAO contract", () => {
  runRoomDaoContract(async (options) => createInMemoryRoomDao(options));
});
