import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTimeLeft, useNow } from "./useNow.js";

const MINUTE = 60_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("starts at the current time and ticks every interval until unmounted", () => {
    vi.useFakeTimers({ now: 1_000 });
    const { result, unmount } = renderHook(() => useNow(MINUTE));
    expect(result.current).toBe(1_000);

    act(() => vi.advanceTimersByTime(MINUTE));
    expect(result.current).toBe(1_000 + MINUTE);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("formatTimeLeft", () => {
  it.each([
    [2 * 24 * 60 * MINUTE + 4 * 60 * MINUTE + 30 * MINUTE, "2d 4h"],
    [5 * 60 * MINUTE + 12 * MINUTE, "5h 12m"],
    [3 * MINUTE, "3m"],
    [1, "1m"],
    [0, "0m"],
    [-5 * MINUTE, "0m"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatTimeLeft(ms)).toBe(text);
  });
});
