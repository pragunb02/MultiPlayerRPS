import { describe } from "vitest";
import { createInMemoryTimeZoneDao } from "./inMemoryTimeZoneDao.js";
import { runTimeZoneDaoContract } from "./timeZoneDaoContract.js";

describe("in-memory time zone DAO (test double) honours the time zone DAO contract", () => {
  runTimeZoneDaoContract(async () => createInMemoryTimeZoneDao());
});
