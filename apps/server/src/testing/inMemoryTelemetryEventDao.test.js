import { describe } from "vitest";
import { createInMemoryTelemetryEventDao } from "./inMemoryTelemetryEventDao.js";
import { runTelemetryEventDaoContract } from "./telemetryEventDaoContract.js";

describe("in-memory telemetry event DAO (test double) honours the telemetry event DAO contract", () => {
  runTelemetryEventDaoContract(async () => createInMemoryTelemetryEventDao());
});
