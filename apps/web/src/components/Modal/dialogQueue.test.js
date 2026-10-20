import { describe, expect, it, vi } from "vitest";
import { dialogQueue } from "./dialogQueue.js";

describe("dialogQueue", () => {
  it("shows the first dialog that asked, then the next once it leaves", () => {
    const listener = vi.fn();
    const stop = dialogQueue.subscribe(listener);
    dialogQueue.join("a");
    dialogQueue.join("b");
    expect(dialogQueue.front()).toBe("a");
    dialogQueue.leave("a");
    expect(dialogQueue.front()).toBe("b");
    dialogQueue.leave("b");
    expect(dialogQueue.front()).toBe("");
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
  });

  it("changes nothing when a dialog joins twice or leaves without joining", () => {
    const listener = vi.fn();
    const stop = dialogQueue.subscribe(listener);
    dialogQueue.join("a");
    dialogQueue.join("a");
    dialogQueue.leave("never");
    dialogQueue.leave("a");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    dialogQueue.join("c");
    expect(listener).toHaveBeenCalledTimes(2);
    dialogQueue.leave("c");
  });
});
