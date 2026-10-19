import { act, render, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
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

  it("waits quietly at first: no spinner at 399 ms, the spinner at 400 ms without an answer", async () => {
    const answer = later();
    const { result } = renderHook(() => useAction(() => answer.promise, { id: "room.rematch" }));

    act(() => {
      result.current.run();
    });
    expect(result.current).toMatchObject({ id: "room.rematch", phase: ACTION_PHASES.SENDING, busy: true });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current.phase).toBe(ACTION_PHASES.SENDING);
    act(() => vi.advanceTimersByTime(1));

    expect(result.current).toMatchObject({ phase: ACTION_PHASES.PENDING, busy: true });
    expect(ACTION_TIMING).toMatchObject({ PENDING_AFTER_MS: 400, PENDING_AT_LEAST_MS: 300 });
  });

  it("never shows the spinner for an answer at 399 ms, which is a usual round trip from India (CC-239)", async () => {
    const answer = later();
    const { result } = renderHook(() => useAction(() => answer.promise, { id: "x" }));

    act(() => {
      result.current.run();
    });
    act(() => vi.advanceTimersByTime(399));
    await act(async () => answer.resolve("ok"));
    act(() => vi.advanceTimersByTime(ACTION_TIMING.PENDING_AFTER_MS));

    expect(result.current.phase).toBe(ACTION_PHASES.DONE);
  });

  it("keeps the waiting words at least 300 ms once shown, even when the answer comes at 410 ms (CC-239)", async () => {
    const answer = later();
    const { result } = renderHook(() => useAction(() => answer.promise, { id: "x" }));

    let outcome;
    act(() => {
      outcome = result.current.run();
    });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current.waitingShown).toBe(false);
    act(() => vi.advanceTimersByTime(11));
    expect(result.current.waitingShown).toBe(true);
    await act(async () => answer.resolve("ok"));

    // The answer itself is in at once: the press is done and nothing is busy. Only the waiting words stay.
    expect(await outcome).toEqual({ ok: true, value: "ok" });
    expect(result.current).toMatchObject({ phase: ACTION_PHASES.DONE, busy: false, waitingShown: true });
    act(() => vi.advanceTimersByTime(289));
    expect(result.current.waitingShown).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toMatchObject({ phase: ACTION_PHASES.DONE, busy: false, waitingShown: false });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.DONE_FOR_MS - 1));
    expect(result.current.phase).toBe(ACTION_PHASES.DONE);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.phase).toBe(ACTION_PHASES.IDLE);
  });

  it("shows a failure that comes right after the spinner at once, without holding the waiting words", async () => {
    const answer = later();
    const { result } = renderHook(() => useAction(() => answer.promise, { id: "x" }));

    act(() => {
      result.current.run();
    });
    act(() => vi.advanceTimersByTime(410));
    await act(async () => answer.reject(new Error("Cell taken")));

    expect(result.current).toMatchObject({
      phase: ACTION_PHASES.FAILED,
      busy: false,
      waitingShown: false,
      error: { message: "Cell taken" },
    });
    act(() => vi.advanceTimersByTime(ACTION_TIMING.PENDING_AT_LEAST_MS));
    expect(result.current.phase).toBe(ACTION_PHASES.FAILED);
  });

  it("shows an answer at once when the spinner has already been seen for 300 ms", async () => {
    const answer = later();
    const { result } = renderHook(() => useAction(() => answer.promise, { id: "x" }));

    act(() => {
      result.current.run();
    });
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current.phase).toBe(ACTION_PHASES.PENDING);
    await act(async () => answer.resolve("ok"));

    expect(result.current.phase).toBe(ACTION_PHASES.DONE);
  });

  it("starts afresh when pressed again while the last answer still waits for the spinner's 300 ms", async () => {
    const first = later();
    const second = later();
    const fn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAction(fn, { id: "x" }));

    act(() => {
      result.current.run();
    });
    act(() => vi.advanceTimersByTime(410));
    await act(async () => first.resolve("ok"));
    act(() => {
      result.current.run();
    });
    expect(result.current.phase).toBe(ACTION_PHASES.SENDING);
    act(() => vi.advanceTimersByTime(399));

    // The first press's held answer is gone: it never replaces the second press's phase.
    expect(result.current.phase).toBe(ACTION_PHASES.SENDING);
    expect(fn).toHaveBeenCalledTimes(2);
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

  it("runs the newest work for a press in the same step that drew it (CC-288)", () => {
    // The press comes before any plain effect of that step has run, like a press on a busy phone. With the work kept
    // in a plain effect it ran the work from the render before, such as loading the first page of matches again.
    function PressOnDraw({ work, press }) {
      const action = useAction(work, { id: "profile.more" });
      useLayoutEffect(() => {
        if (press) action.run();
      }, [press, action]);
      return null;
    }
    const first = vi.fn(async () => "page 1");
    const newest = vi.fn(async () => "page 2");
    const view = render(<PressOnDraw work={first} press={false} />);

    view.rerender(<PressOnDraw work={newest} press />);

    expect(newest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
