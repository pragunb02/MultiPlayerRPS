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

  it("accepts every documented level", () => {
    for (const level of LOG_LEVELS) {
      expect(createLogger({ level, destination: { write() {} } }).level).toBe(level);
    }
  });
});
