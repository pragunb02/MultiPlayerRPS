import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createLogger } from "../../utils/logger.js";
import { createLogForwarder } from "./logForwarder.js";
import { createTelemetrySchema } from "./telemetrySchema.js";

const schema = createTelemetrySchema({ matchSteps: ["record match", "apply progression"] });

/** A real logger whose lines at warn and above also go to the forwarder, as in production. */
function setup({ now = () => 0 } = {}) {
  const emitted = [];
  const suppressed = [];
  const forwarder = createLogForwarder({
    schema,
    emit: (record) => emitted.push(record),
    onSuppressed: () => suppressed.push(now()),
    now,
  });
  const stdout = [];
  const logger = createLogger({
    level: "info",
    destination: { write: (line) => stdout.push(line) },
    forward: forwarder,
  });
  return { logger, emitted, stdout, suppressed };
}

describe("createLogForwarder", () => {
  it("forwards a named error line with its allowed fields and the error's class only", () => {
    const { logger, emitted } = setup();
    class MongoServerError extends Error {}
    const err = new MongoServerError("E11000 duplicate key: canary.sam@example.com");

    logger.error(
      { err, matchId: "m-1", step: "apply progression", attempts: 10, alert: true, playerId: "user_1" },
      "match pipeline failed",
    );

    expect(emitted).toEqual([
      {
        severityNumber: 17,
        severityText: "ERROR",
        body: "match pipeline failed",
        attributes: { step: "apply progression", attempts: 10, "error.type": "MongoServerError" },
        timestamp: expect.any(Date),
      },
    ]);
    expect(JSON.stringify(emitted)).not.toMatch(/canary|E11000|m-1|user_1|stack/);
  });

  it("keeps the whole line on stdout as before", () => {
    const { logger, stdout } = setup();

    logger.error({ matchId: "m-1", step: "record match" }, "match pipeline failed");

    expect(JSON.parse(stdout[0])).toMatchObject({ matchId: "m-1", msg: "match pipeline failed" });
  });

  it("forwards a named warning", () => {
    const { logger, emitted } = setup();

    logger.warn(
      { event: SOCKET_EVENTS.GAME_MOVE, socketId: "abc" },
      "socket event without acknowledgement ignored",
    );

    expect(emitted).toEqual([
      expect.objectContaining({
        severityNumber: 13,
        severityText: "WARN",
        attributes: { event: SOCKET_EVENTS.GAME_MOVE },
      }),
    ]);
  });

  it("forwards a fatal line as fatal", () => {
    const { logger, emitted } = setup();

    logger.fatal({ err: new TypeError("boom at sam@example.com") }, "uncaught exception");

    expect(emitted).toEqual([
      expect.objectContaining({
        severityNumber: 21,
        severityText: "FATAL",
        attributes: { "error.type": "TypeError" },
      }),
    ]);
  });

  it("does not forward a line whose message is not a named line", () => {
    const { logger, emitted } = setup();

    logger.error({ email: "canary.sam@example.com" }, "login failed for canary.sam@example.com");

    expect(emitted).toEqual([]);
  });

  it("forwards a named info line, such as the start of the server, without its fields", () => {
    const { logger, emitted } = setup();

    logger.info({ host: "0.0.0.0", port: 10000, env: "production" }, "server listening");

    expect(emitted).toEqual([
      expect.objectContaining({ severityText: "INFO", body: "server listening", attributes: {} }),
    ]);
  });

  it("is not fooled by a field that holds the text of a named line", () => {
    const { logger, emitted } = setup();

    logger.info({ note: 'x","msg":"server listening' }, "socket connected");
    logger.error({ note: '"msg":"unhandled error"}' }, "something else");

    expect(emitted).toEqual([]);
  });

  it("sends at most 30 of the same line a minute, counts the rest, and sends again the next minute", () => {
    let clock = 0;
    const { logger, emitted, suppressed } = setup({ now: () => clock });

    for (let i = 0; i < 35; i += 1) logger.error("unhandled error");
    logger.error({ step: "judge" }, "match pipeline failed");
    clock = 59_999;
    logger.error("unhandled error");
    clock = 60_000;
    logger.error("unhandled error");

    expect(emitted.filter(({ body }) => body === "unhandled error")).toHaveLength(31);
    expect(emitted.filter(({ body }) => body === "match pipeline failed")).toHaveLength(1);
    expect(suppressed).toHaveLength(6);
  });

  it("does not forward info lines that are not named at info", () => {
    const { logger, emitted } = setup();

    logger.info({ roomCode: "AB2CDE" }, "socket connected");
    logger.info("request completed");

    expect(emitted).toEqual([]);
  });

  it("forwards request lines at error level only", () => {
    const { logger, emitted } = setup();

    logger.warn({ status: 404, path: "/room/AB2CDE", route: "unmatched" }, "request completed");
    logger.error(
      { status: 500, path: "/api/session", route: "/api/session", errorCode: "INTERNAL", requestId: "r-1" },
      "request completed",
    );

    expect(emitted.map(({ attributes }) => attributes)).toEqual([
      { status: 500, route: "/api/session", errorCode: "INTERNAL" },
    ]);
  });

  it("forwards a field whose value breaks its rule as it is, for the scrubber to count", () => {
    const { logger, emitted } = setup();

    logger.error({ route: "/room/AB2CDE" }, "unhandled error");

    expect(emitted[0].attributes).toEqual({ route: "/room/AB2CDE" });
  });

  it("ignores a line that is not JSON instead of failing the logger", () => {
    const emitted = [];
    const forwarder = createLogForwarder({ schema, emit: (record) => emitted.push(record) });

    forwarder.write("not json\n");
    forwarder.write('{"level":50,broken,"msg":"unhandled error"}\n');

    expect(emitted).toEqual([]);
  });

  it("takes the time from the line", () => {
    const emitted = [];
    const forwarder = createLogForwarder({ schema, emit: (record) => emitted.push(record) });

    forwarder.write(
      `${JSON.stringify({ level: 50, time: "2026-10-20T10:00:00.000Z", msg: "unhandled error" })}\n`,
    );

    expect(emitted[0].timestamp).toEqual(new Date("2026-10-20T10:00:00.000Z"));
  });
});
