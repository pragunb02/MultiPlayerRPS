import { assertDefined, assertFunction } from "../../utils/assert.js";

/**
 * How the match pipeline retries (CC-111, ADR-035). A failed attempt waits `firstDelayMs`, then twice as long after
 * each further failure, never more than `maxDelayMs`. After `maxAttempts` failed attempts the game is marked
 * failed. The defaults wait about 13 minutes in all, longer than an Atlas primary change. A done game is kept
 * `keepDoneMs`, longer than any room lives, so a finished room seen again never runs its game twice.
 */
export const MATCH_RETRY_POLICY = Object.freeze({
  firstDelayMs: 2_000,
  maxDelayMs: 300_000,
  maxAttempts: 10,
  keepDoneMs: 2 * 24 * 60 * 60 * 1000,
});

/**
 * The retry policy with some values changed (tests make it short).
 *
 * @param {Partial<typeof MATCH_RETRY_POLICY>} [overrides]
 * @returns {Readonly<typeof MATCH_RETRY_POLICY>}
 */
export function matchRetryPolicy(overrides = {}) {
  const policy = Object.freeze({ ...MATCH_RETRY_POLICY, ...overrides });
  if (!(policy.maxAttempts >= 1) || !(policy.firstDelayMs > 0) || policy.maxDelayMs < policy.firstDelayMs) {
    throw new RangeError(
      "A retry policy needs at least one attempt and a cap no shorter than the first wait",
    );
  }
  return policy;
}

/**
 * How long to wait after the `attempt`th failed attempt.
 *
 * @param {number} attempt  1 for the first failure
 * @param {Readonly<typeof MATCH_RETRY_POLICY>} policy
 */
export const delayAfter = (attempt, policy) =>
  Math.min(policy.maxDelayMs, policy.firstDelayMs * 2 ** (attempt - 1));

/**
 * @typedef {Object} MatchStep           one named step of the match pipeline
 * @property {string} name
 * @property {ReadonlyArray<string>} [needs]   earlier steps that must be done first
 * @property {(input: { matchId: string, match: Readonly<import("../../data/matchAccessor.js").Match>, now: number }) => Promise<unknown>} run
 *   must change nothing when it runs again for the same game, because a game may be run again after a failure
 *   or a restart
 *
 * @typedef {{ matchId: string, status: "done", ran: string[] }
 *   | { matchId: string, status: "retrying", step: string, error: unknown, attempts: number, nextAttemptAt: number }
 *   | { matchId: string, status: "failed", step: string, error: unknown, attempts: number }
 *   | { matchId: string, status: "failed" | "busy" }} RunOutcome
 *   what one run of a game did. `failed` without a step is a game that failed for good before this run, and
 *   `busy` one that this process is running already, or that another run moved to a later attempt meanwhile
 */

function checkSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new RangeError("The match pipeline needs at least one step");
  }
  const seen = new Set();
  for (const { name, needs = [], run } of steps) {
    assertFunction(run, `step ${name}`);
    if (seen.has(name)) throw new RangeError(`Two match pipeline steps are called ${name}`);
    const missing = needs.filter((need) => !seen.has(need));
    if (missing.length > 0) throw new RangeError(`Step ${name} needs ${missing.join(", ")} to come first`);
    seen.add(name);
  }
}

/**
 * The match pipeline's outbox (CC-111, ADR-035). Every finished game is added once and then run through the
 * named steps in order. A step that is done is remembered, so a game that failed or was cut off by a restart
 * resumes at the first step not done. A failing step does not hold back later steps that do not need it. Each
 * step changes nothing the second time, so a game run again still counts once.
 *
 * One process runs the pipeline (one instance, ADR-005). It keeps the games it is running in memory, so the same
 * game never runs twice at the same moment here. A second instance would need a lease in the record (CC-061).
 *
 * @param {{
 *   pendingMatchAccessor: ReturnType<typeof import("../../data/pendingMatchAccessor.js").createPendingMatchAccessor>,
 *   steps: ReadonlyArray<MatchStep>,
 *   policy?: Readonly<typeof MATCH_RETRY_POLICY>,
 * }} deps
 */
export function createMatchOutboxComponent({ pendingMatchAccessor, steps, policy = MATCH_RETRY_POLICY }) {
  assertDefined(pendingMatchAccessor, "pendingMatchAccessor");
  checkSteps(steps);
  const running = new Set();

  /** Runs every step not done yet whose needs are done. Answers what ran now and the first failure, if any. */
  async function runSteps(entry, now) {
    const done = new Set(entry.done);
    const ran = [];
    const failures = [];
    for (const { name, needs = [], run } of steps) {
      if (done.has(name) || !needs.every((need) => done.has(need))) continue;
      try {
        await run({ matchId: entry.matchId, match: entry.match, now });
      } catch (error) {
        failures.push({ step: name, error });
        continue;
      }
      await pendingMatchAccessor.stepDone({ matchId: entry.matchId, step: name });
      done.add(name);
      ran.push(name);
    }
    return { ran, failure: failures[0] };
  }

  async function runEntry(entry, now) {
    const { matchId } = entry;
    const { ran, failure } = await runSteps(entry, now);
    if (failure === undefined) {
      await pendingMatchAccessor.done({ matchId, at: now, keepUntil: now + policy.keepDoneMs });
      return { matchId, status: "done", ran };
    }
    const attempts = entry.attempts + 1;
    const failed = attempts >= policy.maxAttempts;
    const nextAttemptAt = now + delayAfter(attempts, policy);
    const lastError = { step: failure.step, message: String(failure.error?.message ?? failure.error) };
    await pendingMatchAccessor.attemptFailed({ matchId, failed, attempts, nextAttemptAt, lastError });
    return failed
      ? { matchId, status: "failed", ...failure, attempts }
      : { matchId, status: "retrying", ...failure, attempts, nextAttemptAt };
  }

  /**
   * Runs one game, unless this process runs it already. The record is read once this run has the game, because
   * another run may have finished it or moved it to a later attempt since it was listed. With `dueOnly`, a game
   * whose next attempt has not come yet is left alone.
   *
   * @returns {Promise<RunOutcome>}
   */
  async function runOnce(matchId, now, { dueOnly }) {
    if (running.has(matchId)) return { matchId, status: "busy" };
    running.add(matchId);
    try {
      const entry = await pendingMatchAccessor.get(matchId);
      if (entry.status === "done") return { matchId, status: "done", ran: [] };
      if (entry.status === "failed") return { matchId, status: "failed" };
      if (dueOnly && entry.nextAttemptAt > now) return { matchId, status: "busy" };
      return await runEntry(entry, now);
    } finally {
      running.delete(matchId);
    }
  }
  // Whether a batch of due games is running. The next look waits for it to end instead of starting another.
  let batchRunning = false;

  return Object.freeze({
    /**
     * Adds a finished game to the outbox, due at once. Adding a game the outbox already has changes nothing.
     *
     * @param {{ match: Readonly<import("../../data/matchAccessor.js").Match>, now: number }} add
     * @returns {Promise<boolean>} whether it was added now
     */
    add: ({ match, now }) => pendingMatchAccessor.add({ match, at: now }),

    /**
     * Runs one game's steps now, whether or not its next attempt is due (a game that just finished).
     *
     * @param {{ matchId: string, now: number }} input
     * @returns {Promise<RunOutcome>}
     */
    run: ({ matchId, now }) => runOnce(matchId, now, { dueOnly: false }),

    /**
     * Runs the games whose next attempt is due, one after the other. While an earlier batch still runs, this
     * answers nothing at once.
     *
     * @param {{ now: number, limit?: number }} input  `limit` games at most in one go
     * @returns {Promise<RunOutcome[]>}
     */
    async runDue({ now, limit = 20 }) {
      if (batchRunning) return [];
      batchRunning = true;
      try {
        const outcomes = [];
        for (const { matchId } of await pendingMatchAccessor.listDue({ now, limit })) {
          outcomes.push(await runOnce(matchId, now, { dueOnly: true }));
        }
        return outcomes;
      } finally {
        batchRunning = false;
      }
    },
  });
}
