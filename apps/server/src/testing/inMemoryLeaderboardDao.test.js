import { describe } from "vitest";
import { createInMemoryLeaderboardDao } from "./inMemoryLeaderboardDao.js";
import { runLeaderboardDaoContract } from "./leaderboardDaoContract.js";

describe("in-memory leaderboard DAO (test double) honours the leaderboard DAO contract", () => {
  runLeaderboardDaoContract(async () => createInMemoryLeaderboardDao());
});
