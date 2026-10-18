import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCountdown, useServerCountdown } from "./useServerCountdown.js";

const SERVER_T = 5_000_000;

afterEach(() => {
  vi.useRealTimers();
});

/** The device clock is far off the server's on purpose: only the time since the view arrived may count. */
function countdown({ until, serverTime = SERVER_T, onElapsed = vi.fn() }) {
  vi.useFakeTimers({ now: 1_000 });
  const view = renderHook((props) => useServerCountdown({ onElapsed, ...props }), {
    initialProps: { until, serverTime },
  });
  return { ...view, onElapsed };
}

describe("useServerCountdown", () => {
  it("counts down in server time, whatever this device's clock says", () => {
    const { result } = countdown({ until: SERVER_T + 90_000 });
    expect(result.current).toBe(90_000);

    act(() => vi.advanceTimersByTime(30_000));

    expect(result.current).toBe(60_000);
  });

  it("calls onElapsed once when the moment comes, then stops ticking", () => {
    const { result, onElapsed } = countdown({ until: SERVER_T + 2_000 });

    act(() => vi.advanceTimersByTime(5_000));

    expect(result.current).toBe(0);
    expect(onElapsed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("calls onElapsed straight away for a moment that has already passed", () => {
    const { result, onElapsed } = countdown({ until: SERVER_T - 1 });

    expect(result.current).toBe(0);
    expect(onElapsed).toHaveBeenCalledOnce();
  });

  it("still reaches 0 when the moment passes between the render and the timer starting, on a busy device", () => {
    vi.useFakeTimers({ now: 1_000 });
    const onElapsed = vi.fn();
    // The render reads the clock first, then the effect finds the moment already past.
    const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValue(4_000);
    const { result } = renderHook(() =>
      useServerCountdown({ until: SERVER_T + 2_000, serverTime: SERVER_T, onElapsed, now: clock }),
    );
    expect(onElapsed).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(0));

    expect(result.current).toBe(0);
  });

  it("forgets the late update when unmounted at once", () => {
    vi.useFakeTimers({ now: 1_000 });
    const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValue(4_000);
    const { unmount } = renderHook(() =>
      useServerCountdown({ until: SERVER_T + 2_000, serverTime: SERVER_T, onElapsed: vi.fn(), now: clock }),
    );

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts measuring again from a newer view of the server", () => {
    const { result, rerender } = countdown({ until: SERVER_T + 60_000 });
    act(() => vi.advanceTimersByTime(10_000));

    rerender({ until: SERVER_T + 60_000, serverTime: SERVER_T + 40_000 });

    expect(result.current).toBe(20_000);
  });

  it("uses the latest onElapsed without restarting the timer", () => {
    const { rerender, onElapsed } = countdown({ until: SERVER_T + 2_000 });
    const later = vi.fn();

    rerender({ until: SERVER_T + 2_000, serverTime: SERVER_T, onElapsed: later });
    act(() => vi.advanceTimersByTime(2_000));

    expect(onElapsed).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledOnce();
  });

  it("stops when unmounted", () => {
    const { unmount } = countdown({ until: SERVER_T + 60_000 });

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("formatCountdown", () => {
  it.each([
    [30 * 60_000, "30:00"],
    [12 * 60_000 + 34_000, "12:34"],
    [59_001, "1:00"],
    [9_000, "0:09"],
    [1, "0:01"],
    [0, "0:00"],
    [-5_000, "0:00"],
    [3_723_000, "1:02:03"],
  ])("%d ms is shown as %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});
