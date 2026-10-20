import { describe } from "vitest";
import { runChallengeDaoContract } from "./challengeDaoContract.js";
import { createInMemoryChallengeDao } from "./inMemoryChallengeDao.js";

describe("in-memory challenge DAO (test double) honours the challenge DAO contract", () => {
  runChallengeDaoContract(async () => createInMemoryChallengeDao());
});
