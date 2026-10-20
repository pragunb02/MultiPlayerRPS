import {
  assertFlagRegistry,
  FLAG_AUDIENCES,
  FLAG_SIDES,
  FLAGS,
  IDENTITY_KINDS,
  isRollout,
} from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { dayOf } from "../../utils/indiaTime.js";
import { peopleCount } from "../analytics/privacy.js";
import { AUDIENCES } from "../safety/agePolicy.js";
import { bucketFrom, inAudience, inRollout } from "./flagRules.js";

/** How often the overrides are read again and the counts written, in production. */
export const FLAG_REFRESH_MS = 30_000;
/**
 * How long the last overrides read are trusted while the database cannot be reached. After that every flag goes
 * back to the rollout in code, which is off unless a reviewed pull request said otherwise.
 */
export const OVERRIDES_STALE_MS = 5 * 60_000;
/** How long a day's counts are kept before MongoDB removes them. */
export const COUNTS_KEEP_DAYS = 90;
/** How many India days the console adds up, today included. */
export const CONSOLE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_COUNTS = Object.freeze({ exposures: 0, successes: 0 });

/**
 * @typedef {import("./flagRules.js").FlagPlayer} FlagPlayer
 * @typedef {import("@classicade/shared/src/flags.js").FeatureFlag} FeatureFlag
 */

/**
 * Feature flags on the server (CC-312, ADR-073). It works out whether a flag is on for a player, keeps the owner's
 * overrides in memory, and counts how often each side was shown and how often its success event happened, with no
 * id of anyone.
 *
 * The overrides are read from the database at boot and every FLAG_REFRESH_MS. When a read fails, the last good
 * overrides stay in use for OVERRIDES_STALE_MS, so a short blip does not flip a ramped feature, and then the code's
 * rollout applies, so a long outage can only turn features off. Counts wait in memory and are added to the
 * database on each refresh. A failed write keeps them for the next one.
 *
 * @param {{
 *   registry?: ReadonlyArray<Readonly<FeatureFlag>>,
 *   flagAccessor: ReturnType<typeof import("../../data/featureFlagAccessor.js").createFeatureFlagAccessor>,
 *   keyedIds: ReturnType<typeof import("../../utils/keyedIds.js").createKeyedIds>,
 *   safety: Pick<ReturnType<typeof import("../safety/safetyComponent.js").createSafetyComponent>, "policyFor">,
 *   logger: import("../../utils/logger.js").Logger,
 *   now?: () => number,
 * }} deps  `registry` is FLAGS unless a test gives its own. `keyedIds` must be made under the FLAG_BUCKETS label.
 *   `safety` is the one age policy of CC-152, asked only for the adults audience
 */
export function createFlagComponent({
  registry = FLAGS,
  flagAccessor,
  keyedIds,
  safety,
  logger,
  now = Date.now,
}) {
  assertDefined(flagAccessor, "flagAccessor");
  assertFunction(keyedIds?.idOf, "keyedIds.idOf");
  assertFunction(safety?.policyFor, "safety.policyFor");
  assertDefined(logger, "logger");
  assertFlagRegistry(registry);

  const byName = new Map(registry.map((flag) => [flag.name, flag]));
  /** @type {Map<string, Readonly<{ rollout: import("@classicade/shared/src/flags.js").FlagRollout, updatedAt: number }>>} */
  let overrides = new Map();
  /** The last time the database answered a read or a write of overrides. */
  let lastContact = Number.NEGATIVE_INFINITY;
  /** @type {Map<string, { flag: string, day: string, side: string, exposures: number, successes: number }>} */
  let pending = new Map();
  /**
   * Overrides stored for names no longer in the registry, so the console can list them and the owner can clear them.
   *
   * @type {Map<string, Readonly<{ rollout: unknown, updatedAt: number }>>}
   */
  let orphans = new Map();
  /** Overrides already warned about, so each is logged once per process and not on every refresh. */
  const warned = new Set();
  /**
   * Counts the owner's changes. A refresh that was reading while one happened may hold what the database had
   * before it, so it drops its answer rather than undo the change. Each change counts once before its write and
   * once after, so a read that started during the write is dropped too.
   */
  let changes = 0;

  /** @param {string} name */
  function flagOf(name) {
    const flag = byName.get(name);
    if (flag === undefined) {
      throw new RangeError(`Unknown feature flag "${name}". Add it to packages/shared/src/flags.js first.`);
    }
    return flag;
  }

  /** @param {string} name */
  function knownFlag(name) {
    if (!byName.has(name)) {
      throw new NotFoundError(`Unknown feature flag "${name}"`);
    }
    return byName.get(name);
  }

  /** Runs an owner's change, so a refresh reading at the same time cannot undo it. */
  async function ownerChange(change) {
    changes += 1;
    try {
      return await change();
    } finally {
      changes += 1;
    }
  }

  const fresh = () => now() - lastContact <= OVERRIDES_STALE_MS;
  const rolloutOf = (flag) => (fresh() ? (overrides.get(flag.name)?.rollout ?? flag.rollout) : flag.rollout);

  /**
   * Whether a flag is on for a player. Only the adults audience asks anything outside memory: the age policy, for
   * an account. When that fails the flag's default (off) is the answer.
   *
   * @param {Readonly<FeatureFlag>} flag
   * @param {FlagPlayer | undefined} player
   */
  async function decide(flag, player) {
    try {
      const adult =
        flag.audience === FLAG_AUDIENCES.ADULTS &&
        player?.kind === IDENTITY_KINDS.USER &&
        (await safety.policyFor({ playerId: player.id, now: now() })).audience === AUDIENCES.ADULT;
      if (!inAudience({ audience: flag.audience, player, adult })) return false;
      const bucket = player === undefined ? undefined : bucketFrom(keyedIds.idOf([flag.name, player.id]));
      return inRollout({ rollout: rolloutOf(flag), bucket });
    } catch (err) {
      logger.warn({ err, flag: flag.name }, "feature flag not worked out, default used");
      return flag.default;
    }
  }

  /** Adds to today's counts of one side of a flag, in memory until the next write. */
  function count(flag, on, field) {
    const day = dayOf(now());
    const side = on ? FLAG_SIDES.ON : FLAG_SIDES.OFF;
    const key = JSON.stringify([flag.name, day, side]);
    const row = pending.get(key) ?? { flag: flag.name, day, side, exposures: 0, successes: 0 };
    row[field] += 1;
    pending.set(key, row);
  }

  /**
   * Whether a flag is on for a player, counted as one exposure of its side.
   *
   * @param {string} name  a flag in the registry
   * @param {FlagPlayer | undefined} player  `undefined` for a visitor with no session
   * @returns {Promise<boolean>}
   * @throws {RangeError} for a name not in the registry, which is a mistake in code
   */
  async function isOn(name, player) {
    const flag = flagOf(name);
    const on = await decide(flag, player);
    count(flag, on, "exposures");
    return on;
  }

  /** Reads the overrides again. A failure is logged and the ones in memory stay until they are stale. */
  async function refresh() {
    const changesBefore = changes;
    try {
      const stored = await flagAccessor.listOverrides();
      lastContact = now();
      if (changes !== changesBefore) return;
      const next = new Map();
      const left = new Map();
      stored.forEach(({ name, rollout, updatedAt }) => {
        if (byName.has(name) && isRollout(rollout)) {
          next.set(name, Object.freeze({ rollout, updatedAt }));
          return;
        }
        if (!byName.has(name)) left.set(name, Object.freeze({ rollout, updatedAt }));
        if (!warned.has(name)) {
          warned.add(name);
          logger.warn({ flag: name }, "feature flag override ignored");
        }
      });
      overrides = next;
      orphans = left;
    } catch (err) {
      logger.warn({ err }, "feature flag overrides not read");
    }
  }

  /** Adds the counts in memory to the database. A failure keeps them for the next try. */
  async function flush() {
    const rows = [...pending.values()];
    if (rows.length === 0) return;
    pending = new Map();
    try {
      await flagAccessor.addCounts(
        rows.map((row) => ({
          ...row,
          expiresAt: Date.parse(`${row.day}T00:00:00Z`) + COUNTS_KEEP_DAYS * DAY_MS,
        })),
      );
    } catch (err) {
      logger.warn({ err, rows: rows.length }, "feature flag counts not written");
      rows.forEach((row) => {
        const key = JSON.stringify([row.flag, row.day, row.side]);
        const later = pending.get(key);
        pending.set(
          key,
          later === undefined
            ? row
            : {
                ...row,
                exposures: row.exposures + later.exposures,
                successes: row.successes + later.successes,
              },
        );
      });
    }
  }

  /** The counts of the console's window, from the database and from memory, per flag and side. */
  async function windowCounts() {
    const fromDay = dayOf(now() - (CONSOLE_DAYS - 1) * DAY_MS);
    const sums = new Map();
    const add = ({ flag, side, exposures, successes }) => {
      const key = JSON.stringify([flag, side]);
      const sum = sums.get(key) ?? NO_COUNTS;
      sums.set(key, { exposures: sum.exposures + exposures, successes: sum.successes + successes });
    };
    let read = true;
    try {
      (await flagAccessor.countsSince(fromDay)).forEach(add);
    } catch (err) {
      read = false;
      logger.warn({ err }, "feature flag counts not read");
    }
    [...pending.values()].filter(({ day }) => day >= fromDay).forEach(add);
    return { sums, read };
  }

  /** A side's counts as the console shows them: 1 to 4 becomes "<5" (ADR-036.2). */
  const shown = (sums, name, side) => {
    const { exposures, successes } = sums.get(JSON.stringify([name, side])) ?? NO_COUNTS;
    return { exposures: peopleCount(exposures), successes: peopleCount(successes) };
  };

  return Object.freeze({
    isOn,
    refresh,
    flush,

    /**
     * Whether the web app may ask for a flag: a registered flag marked `client`.
     *
     * @param {unknown} name
     * @returns {boolean}
     */
    isClientFlag: (name) => typeof name === "string" && byName.get(name)?.client === true,

    /**
     * The answers for several flags at once, each counted as an exposure.
     *
     * @param {ReadonlyArray<string>} names
     * @param {FlagPlayer | undefined} player
     * @returns {Promise<Readonly<Record<string, boolean>>>}
     */
    async resolve(names, player) {
      const answers = await Promise.all(names.map((name) => isOn(name, player)));
      return Object.freeze(Object.fromEntries(names.map((name, index) => [name, answers[index]])));
    },

    /**
     * Counts one success of a flag, on the side the server works out for this player, so a player cannot count a
     * success for a side they were never shown.
     *
     * @param {string} name
     * @param {FlagPlayer | undefined} player
     * @throws {RangeError} for a name not in the registry
     */
    async recordSuccess(name, player) {
      const flag = flagOf(name);
      count(flag, await decide(flag, player), "successes");
    },

    /**
     * Sets the owner's rollout of a flag. It applies in this process at once and in others at their next refresh.
     *
     * @param {{ name: string, rollout: unknown }} change
     * @throws {NotFoundError} for a name not in the registry
     * @throws {ValidationError} for a rollout that is not off, on or a whole number from 0 to 100
     */
    async setRollout({ name, rollout }) {
      knownFlag(name);
      if (!isRollout(rollout)) {
        throw new ValidationError("The rollout must be off, on or a whole percentage from 0 to 100", {
          details: { field: "rollout" },
        });
      }
      const stored = await ownerChange(() => flagAccessor.setOverride({ name, rollout, at: now() }));
      overrides = new Map(overrides).set(name, Object.freeze({ rollout, updatedAt: stored.updatedAt }));
      lastContact = now();
      logger.info({ flag: name, rollout }, "feature flag rollout changed");
    },

    /**
     * Goes back to the rollout in code for a flag. It also clears an override left for a flag that has been removed
     * from the registry, which the console lists in `orphans`.
     *
     * @param {{ name: string }} change
     * @returns {Promise<boolean>} whether there was an override
     * @throws {NotFoundError} for a name neither in the registry nor left over in the database
     */
    async clearRollout({ name }) {
      if (!orphans.has(name)) knownFlag(name);
      const cleared = await ownerChange(() => flagAccessor.clearOverride(name));
      overrides = new Map([...overrides].filter(([key]) => key !== name));
      orphans = new Map([...orphans].filter(([key]) => key !== name));
      warned.delete(name);
      lastContact = now();
      logger.info({ flag: name }, "feature flag rollout back to code");
      return cleared;
    },

    /**
     * Every flag for the owner console: its rules from code, the rollout in use, the override if any, and the last
     * CONSOLE_DAYS of counts per side. `source` says whether overrides are in use ("database") or the database could
     * not be reached for too long ("code"). `orphans` are overrides left for flags removed from the registry.
     */
    async overview() {
      const today = dayOf(now());
      const { sums, read } = await windowCounts();
      const useOverrides = fresh();
      return Object.freeze({
        source: useOverrides ? "database" : "code",
        days: CONSOLE_DAYS,
        countsRead: read,
        orphans: Object.freeze(
          [...orphans].map(([name, { rollout, updatedAt }]) => ({ name, rollout, updatedAt })),
        ),
        flags: Object.freeze(
          registry.map((flag) => {
            const override = useOverrides ? overrides.get(flag.name) : undefined;
            return Object.freeze({
              name: flag.name,
              description: flag.description,
              ticket: flag.ticket,
              audience: flag.audience,
              removeBy: flag.removeBy,
              overdue: flag.removeBy < today,
              client: flag.client,
              success: flag.success,
              codeRollout: flag.rollout,
              rollout: rolloutOf(flag),
              override: override === undefined ? undefined : { ...override },
              counts: {
                on: shown(sums, flag.name, FLAG_SIDES.ON),
                off: shown(sums, flag.name, FLAG_SIDES.OFF),
              },
            });
          }),
        ),
      });
    },

    /**
     * Refreshes and writes counts every `intervalMs` until stopped. Stopping writes the counts still in memory.
     * The timer does not keep the process alive.
     *
     * @param {{ intervalMs?: number }} [options]
     * @returns {{ stop: () => Promise<void> }}
     */
    start({ intervalMs = FLAG_REFRESH_MS } = {}) {
      const timer = setInterval(() => {
        refresh().then(flush);
      }, intervalMs);
      timer.unref();
      return Object.freeze({
        async stop() {
          clearInterval(timer);
          await flush();
        },
      });
    },
  });
}
