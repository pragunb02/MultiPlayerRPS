import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../lib/errors.js";
import { ACTION_PHASES, ACTION_TIMING, useAction } from "./useAction.js";

/** A promise the test settles by hand, like a server that answers when told to. */
function later() {
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

describe("useAction (CC-164)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits quietly at first, then shows a spinner after 150 ms without an answer", async () => {
    const answer = later();
    const { result } = renderHook(() => useAction(() => answer.promise, { id: "room.rematch" }));

    act(() => {
      result.current.run();
    });
    expect(result.current).toMatchObject({ id: "room.rematch", phase: ACTION_PHASES.SENDING, busy: true });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.PENDING_AFTER_MS - 1));
    expect(result.current.phase).toBe(ACTION_PHASES.SENDING);
    act(() => vi.advanceTimersByTime(1));

    expect(result.current).toMatchObject({ phase: ACTION_PHASES.PENDING, busy: true });
  });

  it("is done for 600 ms after a success, then idle again, and answers with the value", async () => {
    const { result } = renderHook(() => useAction(async (n) => n * 2, { id: "x" }));

    let outcome;
    await act(async () => {
      outcome = await result.current.run(21);
    });

    expect(outcome).toEqual({ ok: true, value: 42 });
    expect(result.current).toMatchObject({ phase: ACTION_PHASES.DONE, busy: false, error: undefined });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.DONE_FOR_MS));
    expect(result.current.phase).toBe(ACTION_PHASES.IDLE);
  });

  it("never shows the spinner for an answer that came quickly", async () => {
    const { result } = renderHook(() => useAction(async () => "ok", { id: "x" }));

    await act(async () => {
      await result.current.run();
    });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.PENDING_AFTER_MS));

    expect(result.current.phase).not.toBe(ACTION_PHASES.PENDING);
  });

  it("keeps a failure with its reason, and offers Retry only when trying again can help", async () => {
    const refused = new AppRequestError({ code: "VALIDATION_FAILED", message: "Cell taken", status: 400 });
    const timedOut = new AppRequestError({ code: "TIMEOUT", message: "The server took too long to answer" });
    const fn = vi.fn().mockRejectedValueOnce(refused).mockRejectedValueOnce(timedOut);
    const { result } = renderHook(() => useAction(fn, { id: "x" }));

    let outcome;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ ok: false, error: refused });
    expect(result.current.error).toEqual({ message: "Cell taken", retryable: false, cause: refused });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.DONE_FOR_MS * 2));
    expect(result.current.phase).toBe(ACTION_PHASES.FAILED);

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toMatchObject({ retryable: true });
  });

  it("describes something thrown that is not an Error", async () => {
    const { result } = renderHook(() =>
      useAction(
        () => {
          throw "plain words";
        },
        { id: "x" },
      ),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.error).toMatchObject({ message: "plain words", retryable: false });
  });

  it("starts the work in the press itself, and a second press waits for the first instead of sending twice", async () => {
    const answer = later();
    const fn = vi.fn(() => answer.promise);
    const { result } = renderHook(() => useAction(fn, { id: "x" }));

    let first;
    let second;
    act(() => {
      first = result.current.run("a");
    });
    expect(fn).toHaveBeenCalledWith("a");
    act(() => {
      second = result.current.run("b");
    });
    await act(async () => answer.resolve("done"));

    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(await second).toEqual({ ok: true, value: "done" });
  });

  it("retries with the same input as the press that failed", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("no")).mockResolvedValue("yes");
    const { result } = renderHook(() => useAction(fn, { id: "x" }));

    await act(async () => {
      await result.current.run({ cell: 4 });
    });
    await act(async () => {
      await result.current.retry();
    });

    expect(fn).toHaveBeenNthCalledWith(2, { cell: 4 });
    expect(result.current.phase).toBe(ACTION_PHASES.DONE);
  });

  it("uses the newest function it was given", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useAction(fn, { id: "x" }), {
      initialProps: { fn: first },
    });

    rerender({ fn: second });
    await act(async () => {
      await result.current.run();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("changes nothing once its button is gone", async () => {
    const answer = later();
    const { result, unmount } = renderHook(() => useAction(() => answer.promise, { id: "x" }));
    act(() => {
      result.current.run();
    });

    unmount();
    await act(async () => answer.resolve("late"));
    act(() => vi.advanceTimersByTime(ACTION_TIMING.DONE_FOR_MS));

    expect(result.current.phase).toBe(ACTION_PHASES.SENDING);
  });
});
