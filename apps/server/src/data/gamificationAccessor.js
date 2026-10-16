import { assertDefined } from "../utils/assert.js";
import { ConflictError } from "../utils/errors.js";

// Exactly-once window: the last N keys (match ids, quest keys) applied per document are remembered.
const RECENT_KEYS = 200;
const MAX_ATTEMPTS = 5;
// Quest days are kept a week after they end (history for support), then MongoDB removes them.
const QUEST_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

const STAT_FIELDS = Object.freeze([
  "winsByGame",
  "matchesByGame",
  "checkmateWins",
  "questsCompleted",
  "winStreak",
  "dailyStreak",
  "mergedFrom",
]);

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const pick = (source, fields) => Object.fromEntries(fields.map((field) => [field, source[field]]));
const remember = (keys, added) =>
  [...keys.filter((key) => !added.includes(key)), ...added].slice(-RECENT_KEYS);

/**
 * Reads a versioned document, or `undefined` with version 0 when there is none yet.
 *
 * @template T
 * @param {() => Promise<T & { version: number }>} find
 */
async function readVersioned(find) {
  try {
    return await find();
  } catch (err) {
    if (err instanceof RangeError) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Read → change → compare-and-set, retried when another write got in between. `change` returns the new domain
 * fields, or `undefined` to leave the document as it is.
 */
async function updateVersioned({ find, save, toDomain, toDoc, change, what }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const doc = await find();
    const next = change(doc, toDomain(doc));
    if (next === undefined) {
      return { applied: false, value: toDomain(doc) };
    }
    if (await save({ doc: toDoc(doc, next), expectedVersion: doc?.version ?? 0 })) {
      return { applied: true, value: deepFreeze(next) };
    }
  }
  throw new ConflictError(`${what} kept changing; giving up after ${MAX_ATTEMPTS} attempts`);
}

/**
 * Gamification data for the domain (CC-054, CC-089): player stats, daily quest snapshots and achievement
 * unlocks. Hides versions, exactly-once windows and storage dates.
 *
 * @param {{
 *   statsDao: ReturnType<typeof import("../persistence/statsDao.js").createStatsDao>,
 *   questDao: ReturnType<typeof import("../persistence/questDao.js").createQuestDao>,
 *   achievementDao: ReturnType<typeof import("../persistence/achievementDao.js").createAchievementDao>,
 * }} deps
 */
export function createGamificationAccessor({ statsDao, questDao, achievementDao }) {
  assertDefined(statsDao, "statsDao");
  assertDefined(questDao, "questDao");
  assertDefined(achievementDao, "achievementDao");

  const statsAccess = (playerId, empty) => ({
    what: "Player stats",
    find: () => readVersioned(() => statsDao.findByPlayer(playerId)),
    save: (write) => statsDao.save(write),
    toDomain: (doc) => deepFreeze(doc === undefined ? empty : { playerId, ...pick(doc, STAT_FIELDS) }),
  });

  const statsDoc =
    ({ playerId, at, addKeys }) =>
    (doc, next) => ({
      playerId,
      ...pick(next, STAT_FIELDS),
      recentKeys: remember(doc?.recentKeys ?? [], addKeys),
      updatedAt: new Date(at),
    });

  const questAccess = ({ playerId, day }) => ({
    what: "Quests",
    find: () => readVersioned(() => questDao.findDay({ playerId, day })),
    save: (write) => questDao.save(write),
    toDomain: (doc) =>
      doc === undefined ? undefined : deepFreeze({ playerId, day, items: doc.items, sweepAt: doc.sweepAt }),
    toDoc: (doc, next) => ({
      playerId,
      day,
      items: next.items,
      sweepAt: next.sweepAt,
      recentKeys: doc?.recentKeys ?? [],
      expiresAt: new Date(Date.parse(`${day}T00:00:00.000Z`) + QUEST_RETENTION_MS),
    }),
  });

  return Object.freeze({
    /**
     * @param {{ playerId: string, empty: Readonly<import("../domain/gamification/stats.js").PlayerStats> }} query
     *   `empty` is what a player without stats has (a domain default)
     * @returns {Promise<Readonly<import("../domain/gamification/stats.js").PlayerStats>>}
     */
    async getStats({ playerId, empty }) {
      const access = statsAccess(playerId, empty);
      return access.toDomain(await access.find());
    },

    /**
     * Changes a player's stats at most once per `key` (a match id or a quest key).
     *
     * @param {{ playerId: string, key: string, at: number, empty: object, change: (stats: object) => object }} update
     * @returns {Promise<{ applied: boolean, stats: Readonly<object> }>}
     */
    async applyToStatsOnce({ playerId, key, at, empty, change }) {
      const access = statsAccess(playerId, empty);
      const { applied, value } = await updateVersioned({
        ...access,
        toDoc: statsDoc({ playerId, at, addKeys: [key] }),
        change: (doc, stats) => (doc?.recentKeys.includes(key) ? undefined : change(stats)),
      });
      return { applied, stats: value };
    },

    /**
     * Rewrites a player's stats (always applied), remembering `seenKeys` as already applied — e.g. after
     * rebuilding stats from match history, so those matches are never counted twice.
     *
     * @param {{ playerId: string, at: number, empty: object, seenKeys: string[], change: (stats: object) => object }} update
     * @returns {Promise<Readonly<object>>}
     */
    async rewriteStats({ playerId, at, empty, seenKeys, change }) {
      const access = statsAccess(playerId, empty);
      const { value } = await updateVersioned({
        ...access,
        toDoc: statsDoc({ playerId, at, addKeys: seenKeys }),
        change: (_doc, stats) => change(stats),
      });
      return value;
    },

    /** @param {string} playerId @returns {Promise<number>} */
    removeStats: (playerId) => statsDao.deleteByPlayer(playerId),

    /**
     * The day's quests, creating the snapshot with `create()` if the player has none for that day yet.
     *
     * @param {{ playerId: string, day: string, create: () => object }} query
     * @returns {Promise<Readonly<import("../domain/gamification/questProgress.js").QuestDay>>}
     */
    async getQuestDay({ playerId, day, create }) {
      const access = questAccess({ playerId, day });
      const { value } = await updateVersioned({
        ...access,
        change: (doc) => (doc === undefined ? create() : undefined),
      });
      return value;
    },

    /**
     * Applies one match to the day's quests at most once (creating the snapshot first if needed).
     *
     * @param {{ playerId: string, day: string, key: string, create: () => object, change: (questDay: object) => object }} update
     * @returns {Promise<{ applied: boolean, questDay: Readonly<import("../domain/gamification/questProgress.js").QuestDay> }>}
     */
    async applyToQuestDayOnce({ playerId, day, key, create, change }) {
      const access = questAccess({ playerId, day });
      const { applied, value } = await updateVersioned({
        ...access,
        toDoc: (doc, next) => ({
          ...access.toDoc(doc, next),
          recentKeys: remember(doc?.recentKeys ?? [], [key]),
        }),
        change: (doc, questDay) => (doc?.recentKeys.includes(key) ? undefined : change(questDay ?? create())),
      });
      return { applied, questDay: value };
    },

    /** @param {string} playerId @returns {Promise<number>} days removed */
    removeQuestDays: (playerId) => questDao.deleteByPlayer(playerId),

    /**
     * @param {string} playerId
     * @returns {Promise<ReadonlyArray<Readonly<{ achievementId: string, unlockedAt: number, matchId: string }>>>}
     */
    async listUnlocks(playerId) {
      const docs = await achievementDao.listByPlayer(playerId);
      return deepFreeze(
        docs.map(({ achievementId, unlockedAt, matchId }) => ({
          achievementId,
          unlockedAt: unlockedAt.getTime(),
          matchId,
        })),
      );
    },

    /**
     * @param {{ playerId: string, achievementId: string, unlockedAt: number, matchId: string }} unlock
     * @returns {Promise<boolean>} true when it was newly unlocked
     */
    async unlock({ playerId, achievementId, unlockedAt, matchId }) {
      const { created } = await achievementDao.upsertEarliest({
        playerId,
        achievementId,
        unlockedAt: new Date(unlockedAt),
        matchId,
      });
      return created;
    },

    /**
     * Moves every unlock of `from` to `to`, keeping the earlier time where both have one. Safe to repeat.
     *
     * @param {{ from: string, to: string }} move
     * @returns {Promise<number>} unlocks moved
     */
    async moveUnlocks({ from, to }) {
      const docs = await achievementDao.listByPlayer(from);
      for (const doc of docs) {
        await achievementDao.upsertEarliest({ ...doc, playerId: to });
      }
      await achievementDao.deleteByPlayer(from);
      return docs.length;
    },
  });
}
