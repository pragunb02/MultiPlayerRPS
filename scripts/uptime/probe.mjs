/**
 * Checks whether the production site answers, allowing for the free plan's cold start: an idle Render instance
 * sleeps, and the first request after that can take most of a minute while it wakes up.
 */

/**
 * @typedef {{ at: string, ms: number, ok: boolean, outcome: string }} Attempt
 * @typedef {{ name: string, url: string, ok: boolean, ms: number, attempts: readonly Attempt[] }} CheckResult
 * @typedef {(response: { status: number, contentType: string, body: string }) => { ok: boolean, outcome: string }} Judge
 * @typedef {{ fetch: typeof fetch, now: () => number, sleep: (ms: number) => Promise<void> }} ProbeDependencies
 * @typedef {{ budgetMs: number, attemptTimeoutMs: number, firstRetryDelayMs: number }} ProbeTiming
 */

/** /health answers 200 with the database up, and 503 while the database is down. */
export const judgeHealth = /** @type {Judge} */ (
  ({ status, body }) => {
    if (status !== 200) {
      return { ok: false, outcome: `HTTP ${status}` };
    }
    const healthy = /"status":"ok"/.test(body) && /"database":"up"/.test(body);
    return healthy
      ? { ok: true, outcome: "HTTP 200, database up" }
      : { ok: false, outcome: "HTTP 200, unexpected body" };
  }
);

/** A page of the web app answers 200 with HTML. */
export const judgePage = /** @type {Judge} */ (
  ({ status, contentType }) => {
    if (status !== 200) {
      return { ok: false, outcome: `HTTP ${status}` };
    }
    return contentType.startsWith("text/html")
      ? { ok: true, outcome: "HTTP 200, HTML" }
      : { ok: false, outcome: `HTTP 200, but ${contentType || "no content type"}` };
  }
);

/** What is checked, in order. The health check gets the long budget, because it is the request that wakes the site. */
export const CHECKS = Object.freeze([
  Object.freeze({
    name: "health",
    path: "/health",
    judge: judgeHealth,
    timing: Object.freeze({ budgetMs: 90_000, attemptTimeoutMs: 45_000, firstRetryDelayMs: 5_000 }),
  }),
  Object.freeze({
    name: "home page",
    path: "/",
    judge: judgePage,
    timing: Object.freeze({ budgetMs: 30_000, attemptTimeoutMs: 15_000, firstRetryDelayMs: 5_000 }),
  }),
]);

/** A retry with less time than this left could not get an answer anyway, so the probe stops instead. */
const MIN_ATTEMPT_MS = 2_000;

/** @param {unknown} err @param {number} timeoutMs */
function describeFailure(err, timeoutMs) {
  const error = /** @type {Error & { cause?: { code?: string } }} */ (err);
  if (error.name === "TimeoutError") {
    return `no answer within ${Math.round(timeoutMs / 1000)} s`;
  }
  return `network error (${error.cause?.code ?? error.message})`;
}

/**
 * Requests the URL until it passes or the time budget runs out, waiting twice as long after each failure.
 *
 * @param {{ name: string, url: string, judge: Judge, timing: ProbeTiming } & ProbeDependencies} params
 * @returns {Promise<CheckResult>}
 */
export async function probe({ name, url, judge, timing, fetch, now, sleep }) {
  const started = now();
  const deadline = started + timing.budgetMs;
  /** @type {Attempt[]} */
  const attempts = [];
  let delay = timing.firstRetryDelayMs;
  for (;;) {
    const attemptStarted = now();
    // A busy runner can wake from a sleep late, past the deadline. Every attempt still gets a real timeout.
    const timeoutMs = Math.max(MIN_ATTEMPT_MS, Math.min(timing.attemptTimeoutMs, deadline - attemptStarted));
    const verdict = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "cache-control": "no-cache", "user-agent": "classicade-uptime-check" },
    }).then(
      async (response) =>
        judge({
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          body: await response.text(),
        }),
      (err) => ({ ok: false, outcome: describeFailure(err, timeoutMs) }),
    );
    attempts.push(
      Object.freeze({ at: new Date(attemptStarted).toISOString(), ms: now() - attemptStarted, ...verdict }),
    );
    const remaining = deadline - now();
    if (verdict.ok || remaining <= MIN_ATTEMPT_MS) {
      return Object.freeze({
        name,
        url,
        ok: verdict.ok,
        ms: now() - started,
        attempts: Object.freeze(attempts),
      });
    }
    // Leave time for one more real attempt inside the budget.
    await sleep(Math.min(delay, remaining - MIN_ATTEMPT_MS));
    delay *= 2;
  }
}

/**
 * Runs every check against the site.
 *
 * @param {{ baseUrl: string } & ProbeDependencies} params
 * @returns {Promise<{ up: boolean, results: readonly CheckResult[] }>}
 */
export async function checkSite({ baseUrl, ...dependencies }) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const check of CHECKS) {
    results.push(await probe({ ...check, url: new URL(check.path, baseUrl).href, ...dependencies }));
  }
  return Object.freeze({ up: results.every(({ ok }) => ok), results: Object.freeze(results) });
}
