import { describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { createLogger, LOG_LEVELS } from "./logger.js";

describe("createLogger", () => {
  it("writes structured JSON with level, time, service and message", () => {
    const { logger, entries } = captureLogger();

    logger.info({ roomCode: "AB12CD" }, "room created");

    expect(entries).toEqual([
      expect.objectContaining({
        level: 30,
        service: "classicade-server",
        roomCode: "AB12CD",
        msg: "room created",
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    ]);
  });

  it("drops entries below the configured level", () => {
    const { logger, entries } = captureLogger({ level: "warn" });

    logger.info("ignored");
    logger.warn("kept");

    expect(entries.map((e) => e.msg)).toEqual(["kept"]);
  });

  it.each([
    [{ password: "hunter22" }, "password"],
    [{ user: { email: "a@b.co" } }, "user.email"],
    [{ session: { token: "abc" } }, "session.token"],
    [{ sessionId: "s%3Aabc" }, "sessionId"],
    [{ req: { headers: { cookie: "connect.sid=abc" } } }, "req.headers.cookie"],
    [{ req: { headers: { authorization: "Bearer abc" } } }, "req.headers.authorization"],
  ])("redacts secrets and personal data: %o", (payload, path) => {
    const { logger, entries } = captureLogger();

    logger.info(payload, "event");

    const value = path.split(".").reduce((obj, key) => obj[key], entries[0]);
    expect(value).toBe("[REDACTED]");
  });

  it("serialises errors with stack and cause", () => {
    const { logger, entries } = captureLogger();
    const err = new Error("save failed", { cause: new Error("connection reset") });

    logger.error({ err }, "unhandled error");

    expect(entries[0].err).toEqual(
      expect.objectContaining({ message: "save failed", stack: expect.any(String) }),
    );
    expect(entries[0].err.cause).toEqual(expect.objectContaining({ message: "connection reset" }));
  });

  it("writes to standard output unless told otherwise", () => {
    const logger = createLogger({ level: "silent" });

    expect(logger.level).toBe("silent");
    expect(typeof logger.info).toBe("function");
  });

  it("accepts every documented level", () => {
    for (const level of LOG_LEVELS) {
      expect(createLogger({ level, destination: { write() {} } }).level).toBe(level);
    }
  });

  it("also writes info and above to a second stream when one is given, redacted the same way", () => {
    const stdout = [];
    const forwarded = [];
    const logger = createLogger({
      level: "info",
      destination: { write: (line) => stdout.push(JSON.parse(line)) },
      forward: { write: (line) => forwarded.push(JSON.parse(line)) },
    });

    logger.debug("debug is off anyway");
    logger.info({ password: "hunter2" }, "on both");
    logger.error("on both too");

    expect(stdout.map((entry) => entry.msg)).toEqual(["on both", "on both too"]);
    expect(forwarded.map((entry) => entry.msg)).toEqual(["on both", "on both too"]);
    expect(forwarded[0].password).toBe("[REDACTED]");
  });

  it("never sends debug lines to the second stream, even when the logger writes them", () => {
    const forwarded = [];
    const logger = createLogger({
      level: "debug",
      destination: { write: () => undefined },
      forward: { write: (line) => forwarded.push(JSON.parse(line)) },
    });

    logger.debug("dropped");
    logger.info("kept");

    expect(forwarded.map((entry) => entry.msg)).toEqual(["kept"]);
  });

  it("sends nothing to the second stream below the logger's own level", () => {
    const forwarded = [];
    const logger = createLogger({
      level: "error",
      destination: { write: () => undefined },
      forward: { write: (line) => forwarded.push(JSON.parse(line)) },
    });

    logger.warn("dropped");
    logger.error("kept");

    expect(forwarded.map((entry) => entry.msg)).toEqual(["kept"]);
  });
});
