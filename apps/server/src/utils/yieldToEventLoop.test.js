import { describe, expect, it } from "vitest";
import { yieldToEventLoop } from "./yieldToEventLoop.js";

describe("yieldToEventLoop", () => {
  it("lets work that was already waiting run before it resolves", async () => {
    const order = [];
    setImmediate(() => order.push("waiting"));

    await yieldToEventLoop();
    order.push("after");

    expect(order).toEqual(["waiting", "after"]);
  });
});
