import { describe } from "vitest";
import { runChessRatingDaoContract } from "./chessRatingDaoContract.js";
import { createInMemoryChessRatingDao } from "./inMemoryChessRatingDao.js";

describe("in-memory chess rating DAO (test double) honours the chess rating DAO contract", () => {
  runChessRatingDaoContract(async () => createInMemoryChessRatingDao());
});
