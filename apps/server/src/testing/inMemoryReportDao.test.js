import { describe } from "vitest";
import { createInMemoryReportDao } from "./inMemoryReportDao.js";
import { runReportDaoContract } from "./reportDaoContract.js";

describe("in-memory report DAO (test double) honours the report DAO contract", () => {
  runReportDaoContract(async () => createInMemoryReportDao());
});
