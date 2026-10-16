import { describe, expect, it } from "vitest";
import { captureLogger } from "../testing/captureLogger.js";
import { createBackgroundTasks } from "./backgroundTasks.js";

describe("createBackgroundTasks", () => {
  it("runs tasks without making the caller wait", async () => {
    const tasks = createBackgroundTasks({ logger: captureLogger().logger });
    let ran = false;

    tasks.run("t", async () => {
      ran = true;
    });

    expect(ran).toBe(false);
    await tasks.drain();
    expect(ran).toBe(true);
  });

  it("logs a failure with the task name and context, without throwing", async () => {
    const { logger, find } = captureLogger();
    const tasks = createBackgroundTasks({ logger });

    tasks.run(
      "write",
      async () => {
        throw new Error("db down");
      },
      { matchId: "m1" },
    );
    await tasks.drain();

    expect(find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "write", matchId: "m1", level: 50 }),
    );
  });

  it("drains tasks started by other tasks", async () => {
    const tasks = createBackgroundTasks({ logger: captureLogger().logger });
    const order = [];

    tasks.run("outer", async () => {
      order.push("outer");
      tasks.run("inner", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("inner");
      });
    });
    await tasks.drain();

    expect(order).toEqual(["outer", "inner"]);
  });

  it("drains immediately when idle", async () => {
    await expect(createBackgroundTasks({ logger: captureLogger().logger }).drain()).resolves.toBeUndefined();
  });
});
