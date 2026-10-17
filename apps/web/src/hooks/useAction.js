import { useCallback, useEffect, useRef, useState } from "react";
import { isRetryable } from "../lib/errors.js";

/**
 * How a button answers a press (docs/ux/MATCH_EXPERIENCE.md, button feedback standard). An answer that comes back
 * quickly needs no spinner, so the spinner waits a little. A success that changes nothing else on screen shows a
 * check for a moment.
 */
export const ACTION_TIMING = Object.freeze({ PENDING_AFTER_MS: 150, DONE_FOR_MS: 600 });

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
 * longer than 150 ms the phase is "pending", so the button can show a spinner. A success is "done" for 600 ms.
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

  const start = useCallback(
    (args) => {
      if (running.current !== undefined) {
        return running.current;
      }
      lastArgs.current = args;
      show({ phase: ACTION_PHASES.SENDING, error: undefined });
      later(ACTION_TIMING.PENDING_AFTER_MS, { phase: ACTION_PHASES.PENDING, error: undefined });
      const answer = call(latest.current, args);
      const attempt = (async () => {
        try {
          const value = await answer;
          show({ phase: ACTION_PHASES.DONE, error: undefined });
          later(ACTION_TIMING.DONE_FOR_MS, IDLE);
          return { ok: true, value };
        } catch (error) {
          window.clearTimeout(timer.current);
          const failure = {
            message: error?.message ?? String(error),
            retryable: isRetryable(error),
            cause: error,
          };
          show({ phase: ACTION_PHASES.FAILED, error: failure });
          return { ok: false, error };
        } finally {
          running.current = undefined;
        }
      })();
      running.current = attempt;
      return attempt;
    },
    [later, show],
  );

  const run = useCallback((...args) => start(args), [start]);
  const retry = useCallback(() => start(lastArgs.current), [start]);
  const busy = state.phase === ACTION_PHASES.SENDING || state.phase === ACTION_PHASES.PENDING;

  return { id, phase: state.phase, busy, error: state.error, run, retry };
}
