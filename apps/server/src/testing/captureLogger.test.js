import { describe, expect, it } from "vitest";
import { captureLogger } from "./captureLogger.js";

describe("captureLogger.once: waits for a log line instead of a timer (CC-309)", () => {
  it("answers with a line written before the wait", async () => {
    const capture = captureLogger();
    capture.logger.info({ step: 1 }, "done");

    await expect(capture.once("done")).resolves.toMatchObject({ msg: "done", step: 1 });
  });

  it("answers when the line is written, and not for another line", async () => {
    const capture = captureLogger();
    const seen = [];
    const waiting = capture.once("done").then((entry) => seen.push(entry.step));

    capture.logger.info({ step: 0 }, "other");
    await Promise.resolve();
    expect(seen).toEqual([]);
    capture.logger.info({ step: 1 }, "done");
    capture.logger.info({ step: 2 }, "done");
    await waiting;

    expect(seen).toEqual([1]);
  });

  it("answers every wait for the same line", async () => {
    const capture = captureLogger();
    const both = Promise.all([capture.once("done"), capture.once("done")]);

    capture.logger.info("done");

    expect((await both).map((entry) => entry.msg)).toEqual(["done", "done"]);
  });
});
