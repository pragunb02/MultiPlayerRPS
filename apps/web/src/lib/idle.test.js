import { describe, expect, it, vi } from "vitest";
import { IDLE_FALLBACK_MS, IDLE_TIMEOUT_MS, whenIdle } from "./idle.js";

describe("whenIdle", () => {
  it("waits for the browser to be idle, and no longer than the time limit", () => {
    const window = { requestIdleCallback: vi.fn(), setTimeout: vi.fn() };
    const run = vi.fn();

    whenIdle({ window, run });

    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: IDLE_TIMEOUT_MS,
    });
    expect(window.setTimeout).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    window.requestIdleCallback.mock.calls[0][0]();
    expect(run).toHaveBeenCalledOnce();
  });

  it("waits a short time instead in a browser that cannot tell when it is idle (Safari)", () => {
    const window = { setTimeout: vi.fn() };
    const run = vi.fn();

    whenIdle({ window, run });

    expect(window.setTimeout).toHaveBeenCalledWith(expect.any(Function), IDLE_FALLBACK_MS);
    window.setTimeout.mock.calls[0][0]();
    expect(run).toHaveBeenCalledOnce();
  });

  it("waits at most a second, so a busy page still connects soon", () => {
    expect(IDLE_TIMEOUT_MS).toBe(1_000);
  });
});
