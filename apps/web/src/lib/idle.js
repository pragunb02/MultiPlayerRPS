/** The longest wait for an idle moment: a page that stays busy still gets on with it after this (CC-333). */
export const IDLE_TIMEOUT_MS = 1_000;

/** The wait instead, in a browser that cannot tell when it is idle (Safari has no `requestIdleCallback`). */
export const IDLE_FALLBACK_MS = 200;

/**
 * Runs `run` once the browser has nothing more urgent to do, such as drawing the first page, and within
 * `IDLE_TIMEOUT_MS` even if it never is idle.
 *
 * @param {{ window: Pick<Window, "setTimeout"> & { requestIdleCallback?: Window["requestIdleCallback"] }, run: () => void }} deps
 */
export function whenIdle({ window, run }) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => run(), { timeout: IDLE_TIMEOUT_MS });
  } else {
    window.setTimeout(() => run(), IDLE_FALLBACK_MS);
  }
}
