import { describe } from "vitest";
import { createInMemoryTelemetryDailyDao } from "./inMemoryTelemetryDailyDao.js";
import { runTelemetryDailyDaoContract } from "./telemetryDailyDaoContract.js";

describe("in-memory telemetry daily DAO (test double) honours the telemetry daily DAO contract", () => {
  runTelemetryDailyDaoContract(async () => createInMemoryTelemetryDailyDao());
});
