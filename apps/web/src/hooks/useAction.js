import { useCallback, useEffect, useRef, useState } from "react";
import { isRetryable } from "../lib/errors.js";

/**
 * How a button answers a press (docs/ux/MATCH_EXPERIENCE.md, button feedback standard). The press and the click
 * answer at once. The spinner waits 400 ms, longer than a usual round trip from India to the server (about 250 to
 * 350 ms), so a normal press never shows it. Once shown it stays at least 300 ms, so an answer just after 400 ms
 * does not make it flash (CC-239). A success that changes nothing else on screen shows a check for a moment.
 */
export const ACTION_TIMING = Object.freeze({
  PENDING_AFTER_MS: 400,
  PENDING_AT_LEAST_MS: 300,
  DONE_FOR_MS: 600,
});

/**
 * The phases of an action. "sending" is the first moment after a press, before the spinner shows. "pending" is
 * a press still waiting for its answer after that. "done" is a success, for a moment. "failed" keeps the reason
 * until the next try.
 */
export const ACTION_PHASES = Object.freeze({
  IDLE: "idle",
  SENDING: "sending",
  PENDING: "pending",
  DONE: "done",
  FAILED: "failed",
});

const IDLE = Object.freeze({ phase: ACTION_PHASES.IDLE, error: undefined });

/** Starts `fn` right away, in the press itself. One that throws at once counts as a failed answer. */
function call(fn, args) {
  try {
    return fn(...args);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * @typedef {Object} ActionFailure
 * @property {string} message     what went wrong, in the server's words
 * @property {boolean} retryable  whether Retry can help (see isRetryable)
 * @property {unknown} cause      what the action threw
 */

/**
 * @typedef {{ ok: true, value: unknown } | { ok: false, error: unknown }} ActionResult
 */

/**
 * One thing a button does, with the feedback every press gets (CC-164). The press runs `fn`. While it waits
 * longer than 400 ms the phase is "pending", so the button can show a spinner, and it stays "pending" at least
 * 300 ms. An answer that comes during those 300 ms is shown when they are up, but `run` answers at once, so a
 * page can move on without waiting. A success is "done" for 600 ms.
 * A failure is "failed" with the reason, and `retry` runs the same press again. A second press while the first
 * is still on its way does not run `fn` twice: it waits for the first.
 *
 * @param {(...args: any[]) => unknown} fn  may return a promise
 * @param {{ id: string }} options  `id` is the control's stable name, the same as its `data-cc-control`
 * @returns {{
 *   id: string,
 *   phase: string,
 *   busy: boolean,
 *   error: ActionFailure | undefined,
 *   run: (...args: any[]) => Promise<ActionResult>,
 *   retry: () => Promise<ActionResult>,
 * }}
 */
export function useAction(fn, { id }) {
  const [state, setState] = useState(IDLE);
  const latest = useRef(fn);
  const timer = useRef(0);
  const holdTimer = useRef(0);
  // While the spinner must stay (`holding`), an outcome that already arrived waits in `held`.
  const holding = useRef(false);
  const held = useRef(undefined);
  const running = useRef(undefined);
  const lastArgs = useRef([]);
  const mounted = useRef(true);

  useEffect(() => {
    latest.current = fn;
  }, [fn]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
      window.clearTimeout(holdTimer.current);
    };
  }, []);

  // A button that went away (the page moved on) has nobody to show its phase to.
  const show = useCallback((next) => mounted.current && setState(next), []);

  const later = useCallback(
    (ms, next) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => show(next), ms);
    },
    [show],
  );

  // Shows the outcome of a press, or keeps it until the spinner has been seen long enough.
  const settle = useCallback(
    (outcome) => {
      if (holding.current) {
        held.current = outcome;
        return;
      }
      show(outcome);
      if (outcome.phase === ACTION_PHASES.DONE) {
        later(ACTION_TIMING.DONE_FOR_MS, IDLE);
      } else {
        window.clearTimeout(timer.current);
      }
    },
    [later, show],
  );

  const release = useCallback(() => {
    holding.current = false;
    const outcome = held.current;
    held.current = undefined;
    if (outcome !== undefined) {
      settle(outcome);
    }
  }, [settle]);

  const startWaiting = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      show({ phase: ACTION_PHASES.PENDING, error: undefined });
      holding.current = true;
      holdTimer.current = window.setTimeout(release, ACTION_TIMING.PENDING_AT_LEAST_MS);
    }, ACTION_TIMING.PENDING_AFTER_MS);
  }, [release, show]);

  const start = useCallback(
    (args) => {
      if (running.current !== undefined) {
        return running.current;
      }
      lastArgs.current = args;
      window.clearTimeout(holdTimer.current);
      holding.current = false;
      held.current = undefined;
      show({ phase: ACTION_PHASES.SENDING, error: undefined });
      startWaiting();
      const answer = call(latest.current, args);
      const attempt = (async () => {
        try {
          const value = await answer;
          settle({ phase: ACTION_PHASES.DONE, error: undefined });
          return { ok: true, value };
        } catch (error) {
          const failure = {
            message: error?.message ?? String(error),
            retryable: isRetryable(error),
            cause: error,
          };
          settle({ phase: ACTION_PHASES.FAILED, error: failure });
          return { ok: false, error };
        } finally {
          running.current = undefined;
        }
      })();
      running.current = attempt;
      return attempt;
    },
    [settle, show, startWaiting],
  );

  const run = useCallback((...args) => start(args), [start]);
  const retry = useCallback(() => start(lastArgs.current), [start]);
  const busy = state.phase === ACTION_PHASES.SENDING || state.phase === ACTION_PHASES.PENDING;

  return { id, phase: state.phase, busy, error: state.error, run, retry };
}
