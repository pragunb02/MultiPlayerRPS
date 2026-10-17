import { levelForXp, MAX_LEVEL, XP_AWARDS, xpForLevel } from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { creditFor } from "../matches/fairPlay.js";

/** Events the progression component publishes. */
export const PROGRESSION_EVENTS = Object.freeze({
  /**
   * { playerId, displayName, source: "match" | "quest", key, matchId, result?, xpGained, leveledUp, progress,
   * counted, notCountedReason } —
   * a player's progress changed: after a match (`key` = matchId), or a quest bonus (`key` = the quest key,
   * `matchId` = ""). A match that didn't count for the player (CC-095) has `counted` false and gives no XP, and
   * `notCountedReason` says why: a NOT_COUNTED_REASONS value, or "" when it counted.
   */
  UPDATED: "progression.updated",
});

/** Where XP came from. */
export const XP_SOURCES = Object.freeze({ MATCH: "match", QUEST: "quest" });

/**
 * How a recorded match went for one player. A player who left a game in progress forfeited it.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @param {string} playerId
 * @returns {"win" | "draw" | "loss" | "forfeit"}
 */
export function resultFor(match, playerId) {
  const forfeitedBy =
    match.result.reason === "forfeit" ? match.log.findLast((e) => e.kind === "forfeit")?.playerId : "";
  if (forfeitedBy === playerId) {
    return "forfeit";
  }
  if (match.result.result === "draw") {
    return "draw";
  }
  return match.result.winners.includes(playerId) ? "win" : "loss";
}

const COUNTER_FOR = Object.freeze({ win: "wins", draw: "draws", loss: "losses", forfeit: "losses" });

/** What one counted match adds to a player's totals. */
const creditOf = (result) => ({ xp: XP_AWARDS[result], matchesPlayed: 1, [COUNTER_FOR[result]]: 1 });
const NOTHING = Object.freeze({ xp: 0 });

/** Adds up totals field by field. */
const addTotals = (total, more) =>
  Object.fromEntries(
    [...new Set([...Object.keys(total), ...Object.keys(more)])].map((key) => [
      key,
      (total[key] ?? 0) + (more[key] ?? 0),
    ]),
  );

/** Level details derived from total XP (what the UI shows as a progress bar). */
function describe(progress) {
  const level = levelForXp(progress.xp);
  const levelStart = xpForLevel(level);
  const nextLevelAt = level === MAX_LEVEL ? levelStart : xpForLevel(level + 1);
  return Object.freeze({
    ...progress,
    level,
    xpIntoLevel: progress.xp - levelStart,
    xpForNextLevel: nextLevelAt - levelStart,
  });
}

/**
 * XP and levels, earned only from recorded matches that count (never per round or for joining, CC-095).
 *
 * @param {{
 *   progressAccessor: ReturnType<typeof import("../../data/progressAccessor.js").createProgressAccessor>,
 *   matchAccessor: Pick<ReturnType<typeof import("../../data/matchAccessor.js").createMatchAccessor>, "listWithdrawn">,
 *   events: { emit: (event: string, payload: unknown) => void },
 * }} deps
 */
export function createProgressionComponent({ progressAccessor, matchAccessor, events }) {
  assertDefined(progressAccessor, "progressAccessor");
  assertFunction(matchAccessor?.listWithdrawn, "matchAccessor.listWithdrawn");
  assertDefined(events, "events");

  return Object.freeze({
    /**
     * Awards every player of a recorded match their XP, once. A player the match doesn't count for gets nothing,
     * and their update says why. Publishes one update per player.
     *
     * @param {Readonly<import("../../data/matchAccessor.js").Match>} match  as judged by `matchComponent.judge`
     */
    async applyMatch(match) {
      const updates = [];
      for (const { playerId, displayName } of match.players) {
        const result = resultFor(match, playerId);
        const credit = creditFor(match, playerId);
        // Applied even when it adds nothing, so the player hears why exactly once.
        const inc = credit.counted ? creditOf(result) : NOTHING;
        const { applied, before, after } = await progressAccessor.applyMatchOnce({
          playerId,
          matchId: match.matchId,
          inc,
          at: match.endedAt,
        });
        if (!applied) {
          continue;
        }
        const update = {
          playerId,
          displayName,
          source: XP_SOURCES.MATCH,
          key: match.matchId,
          matchId: match.matchId,
          result,
          xpGained: inc.xp,
          leveledUp: levelForXp(after.xp) > levelForXp(before.xp),
          progress: describe(after),
          counted: credit.counted,
          notCountedReason: credit.counted ? "" : credit.reason,
        };
        events.emit(PROGRESSION_EVENTS.UPDATED, update);
        updates.push(update);
      }
      return updates;
    },

    /**
     * Awards bonus XP (a completed quest) at most once per `key`. It adds XP only — it is not a match played.
     * Publishes an update when it was awarded.
     *
     * @param {{ playerId: string, displayName: string, key: string, xp: number, at: number }} bonus
     * @returns {Promise<{ applied: boolean }>}
     */
    async awardBonus({ playerId, displayName, key, xp, at }) {
      const { applied, before, after } = await progressAccessor.applyAwardOnce({
        playerId,
        key,
        inc: { xp },
        at,
      });
      if (applied) {
        events.emit(PROGRESSION_EVENTS.UPDATED, {
          playerId,
          displayName,
          source: XP_SOURCES.QUEST,
          key,
          matchId: "",
          xpGained: xp,
          leveledUp: levelForXp(after.xp) > levelForXp(before.xp),
          progress: describe(after),
          counted: true,
          notCountedReason: "",
        });
      }
      return Object.freeze({ applied });
    },

    /** @param {string} playerId */
    async getProgress(playerId) {
      return describe(await progressAccessor.get(playerId));
    },

    /**
     * A guest's XP and totals become their account's (CC-032), added to what the account already has; the level
     * follows from the XP. The games that stopped counting when they moved to the account (it had reached a fair
     * play limit that day, CC-095) are taken out first, so the account never gets more than the limits allow.
     * Runs after the matches moved. Idempotent and resumable.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ moved: Readonly<Record<string, number>> }>} the totals added now
     */
    async transferPlayer({ from, to, now }) {
      const withdrawn = await matchAccessor.listWithdrawn({ playerId: to.id, from });
      const withdraw = withdrawn.map((match) => creditOf(resultFor(match, to.id))).reduce(addTotals, {});
      return progressAccessor.mergeInto({ from, to: to.id, at: now, withdraw });
    },
  });
}
