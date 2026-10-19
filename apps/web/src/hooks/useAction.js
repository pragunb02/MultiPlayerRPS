import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

const IDLE = Object.freeze({ phase: ACTION_PHASES.IDLE, error: undefined, labelHeld: false });

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
 * longer than 400 ms the phase is "pending", so the button can show a spinner. A success is "done" for 600 ms.
 * A failure is "failed" with the reason, and `retry` runs the same press again. A second press while the first
 * is still on its way does not run `fn` twice: it waits for the first.
 *
 * `phase`, `busy` and `error` always follow the answer at once, so a board can take the next move and a refusal
 * shows straight away. Only `waitingShown`, which the button reads for its spinner and waiting words, stays true
 * at least 300 ms once the spinner showed. A success that arrives in those 300 ms shows its check after them, and
 * a failure ends them at once (CC-239).
 *
 * @param {(...args: any[]) => unknown} fn  may return a promise
 * @param {{ id: string }} options  `id` is the control's stable name, the same as its `data-cc-control`
 * @returns {{
 *   id: string,
 *   phase: string,
 *   busy: boolean,
 *   waitingShown: boolean,
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
  // `holding`: the spinner shows and its 300 ms are not up. `doneHeld`: a success came in that time.
  const holding = useRef(false);
  const doneHeld = useRef(false);
  const running = useRef(undefined);
  const lastArgs = useRef([]);
  const mounted = useRef(true);

  // A layout effect runs in the same step that updates the page. A plain effect can run a moment later, and a press
  // in that moment would run the work from the render before, for example loading the first page of matches again
  // instead of the next one (CC-288).
  useLayoutEffect(() => {
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

  const stopHolding = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    holding.current = false;
    doneHeld.current = false;
  }, []);

  // Shows the answer to a press at once. Only a success keeps the waiting words until the spinner's time is up.
  const settle = useCallback(
    (outcome) => {
      if (outcome.phase === ACTION_PHASES.DONE && holding.current) {
        doneHeld.current = true;
        show({ ...outcome, labelHeld: true });
        return;
      }
      stopHolding();
      show({ ...outcome, labelHeld: false });
      if (outcome.phase === ACTION_PHASES.DONE) {
        later(ACTION_TIMING.DONE_FOR_MS, IDLE);
      } else {
        window.clearTimeout(timer.current);
      }
    },
    [later, show, stopHolding],
  );

  const release = useCallback(() => {
    const done = doneHeld.current;
    holding.current = false;
    doneHeld.current = false;
    if (done) {
      show({ phase: ACTION_PHASES.DONE, error: undefined, labelHeld: false });
      later(ACTION_TIMING.DONE_FOR_MS, IDLE);
    }
  }, [later, show]);

  const startWaiting = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      show({ phase: ACTION_PHASES.PENDING, error: undefined, labelHeld: false });
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
      stopHolding();
      show({ phase: ACTION_PHASES.SENDING, error: undefined, labelHeld: false });
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
    [settle, show, startWaiting, stopHolding],
  );

  const run = useCallback((...args) => start(args), [start]);
  const retry = useCallback(() => start(lastArgs.current), [start]);
  const busy = state.phase === ACTION_PHASES.SENDING || state.phase === ACTION_PHASES.PENDING;
  const waitingShown = state.phase === ACTION_PHASES.PENDING || state.labelHeld;

  return { id, phase: state.phase, busy, waitingShown, error: state.error, run, retry };
}
