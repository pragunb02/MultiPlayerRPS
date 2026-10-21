import { GAMES } from "@classicade/shared";
import { dayOf } from "../../utils/indiaTime.js";

/** How a search ended, as the counts name it (CC-051). */
export const COUNT_OUTCOMES = Object.freeze({
  /** A person was found. */
  MATCHED: "matched",
  /** The search ran out of time and the computer character started. */
  TIMED_OUT: "timed_out",
  /** No search ran, because the site was empty or the age policy keeps the player out: the character started. */
  SKIPPED: "skipped",
  /** The player cancelled, left or hid the page, or started a newer search. */
  CANCELLED: "cancelled",
  /** The game could not be started (a room limit, a fault of ours). */
  FAILED: "failed",
});

/** The upper edges of the wait buckets, in ms. A wait above the last is in `over_4000`. */
export const WAIT_BUCKET_EDGES_MS = Object.freeze([500, 1_000, 2_000, 3_000, 4_000]);

/**
 * The bucket of one wait, such as `upto_1000`. Waits are only ever counted in buckets, never one by one.
 *
 * @param {number} waitMs
 */
export function waitBucketOf(waitMs) {
  const edge = WAIT_BUCKET_EDGES_MS.find((each) => waitMs <= each);
  return edge === undefined ? `over_${WAIT_BUCKET_EDGES_MS.at(-1)}` : `upto_${edge}`;
}

const HOUR_MS = 3_600_000;
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60_000;
const GAME_IDS = new Set(GAMES.map(({ id }) => id));
const OUTCOMES = new Set(Object.values(COUNT_OUTCOMES));

/**
 * Anonymous counts of quick match searches (ADR-034, ADR-079): per India day, India hour slot, game and outcome,
 * how many searches ended that way and their waits in buckets. No player, session, socket or room id is ever
 * given to it, so none can be kept. The ADR-029 gate reads the share of searches matched within 4 s per hour slot,
 * and the friction guardrail reads the share cancelled and the waits of searches that ran out of time.
 *
 * The counts live in this process until `drain` takes them (the composition root logs them once a minute).
 *
 * @param {{ now: () => number }} deps
 */
export function createQuickMatchCounts({ now }) {
  /** @type {Map<string, { day: string, hour: number, gameId: string, outcome: string, searches: number, waits: Record<string, number> }>} */
  let rows = new Map();

  function drain() {
    const taken = [...rows.values()].map((row) => Object.freeze({ ...row, waits: Object.freeze(row.waits) }));
    rows = new Map();
    return Object.freeze(taken);
  }

  return Object.freeze({
    /**
     * Counts one search that ended.
     *
     * @param {{ gameId: string, outcome: string, waitMs: number }} search  `outcome` a COUNT_OUTCOMES value
     * @throws {RangeError} for an unknown game or outcome, so free text can never become a key
     */
    record({ gameId, outcome, waitMs }) {
      if (!GAME_IDS.has(gameId) || !OUTCOMES.has(outcome)) {
        throw new RangeError(`Not a quick match count: ${String(gameId)} ${String(outcome)}`);
      }
      const at = now();
      const day = dayOf(at);
      const hour = Math.floor((at + INDIA_OFFSET_MS) / HOUR_MS) % 24;
      const key = JSON.stringify([day, hour, gameId, outcome]);
      const row = rows.get(key) ?? { day, hour, gameId, outcome, searches: 0, waits: {} };
      const bucket = waitBucketOf(waitMs);
      rows.set(key, {
        ...row,
        searches: row.searches + 1,
        waits: { ...row.waits, [bucket]: (row.waits[bucket] ?? 0) + 1 },
      });
    },

    /**
     * Writes the counts since the last time to the log every `everyMs`, as one line with no id of anyone, until
     * `stop`, which writes the last ones. Until the analytics events exist (CC-174), the owner reads them in the
     * host's logs, like the room gauge (ADR-035.6).
     *
     * @param {{ logger: import("../../utils/logger.js").Logger, everyMs: number }} options
     * @returns {{ stop: () => void }}
     */
    logEvery({ logger, everyMs }) {
      const write = () => {
        const taken = drain();
        if (taken.length > 0) logger.info({ counts: taken }, "quick match counts");
      };
      const timer = setInterval(write, everyMs);
      timer.unref?.();
      return Object.freeze({
        stop() {
          clearInterval(timer);
          write();
        },
      });
    },

    /**
     * The counts since the last drain, and forgets them.
     *
     * @returns {ReadonlyArray<Readonly<{ day: string, hour: number, gameId: string, outcome: string, searches: number, waits: Readonly<Record<string, number>> }>>}
     */
    drain,
  });
}
