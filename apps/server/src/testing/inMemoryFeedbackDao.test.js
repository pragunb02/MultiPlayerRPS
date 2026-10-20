import { describe } from "vitest";
import { runFeedbackDaoContract } from "./feedbackDaoContract.js";
import { createInMemoryFeedbackDao } from "./inMemoryFeedbackDao.js";

describe("in-memory feedback DAO (test double) honours the feedback DAO contract", () => {
  runFeedbackDaoContract(async () => createInMemoryFeedbackDao());
});
