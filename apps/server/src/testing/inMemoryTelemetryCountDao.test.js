import { describe } from "vitest";
import { createInMemoryTelemetryCountDao } from "./inMemoryTelemetryCountDao.js";
import { runTelemetryCountDaoContract } from "./telemetryCountDaoContract.js";

describe("in-memory telemetry count DAO (test double) honours the telemetry count DAO contract", () => {
  runTelemetryCountDaoContract(async () => createInMemoryTelemetryCountDao());
});
