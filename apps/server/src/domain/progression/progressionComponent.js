import { levelForXp, MAX_LEVEL, XP_AWARDS, xpForLevel } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";

/** Events the progression component publishes. */
export const PROGRESSION_EVENTS = Object.freeze({
  /**
   * { playerId, displayName, source: "match" | "quest", key, matchId, result?, xpGained, leveledUp, progress } —
   * a player's progress changed: after a match (`key` = matchId), or a quest bonus (`key` = the quest key,
   * `matchId` = "").
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
 * XP and levels, earned only from recorded matches (never per round or for joining).
 *
 * @param {{
 *   progressAccessor: ReturnType<typeof import("../../data/progressAccessor.js").createProgressAccessor>,
 *   events: { emit: (event: string, payload: unknown) => void },
 * }} deps
 */
export function createProgressionComponent({ progressAccessor, events }) {
  assertDefined(progressAccessor, "progressAccessor");
  assertDefined(events, "events");

  return Object.freeze({
    /**
     * Awards every player of a recorded match their XP, once. Publishes one update per player.
     *
     * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
     */
    async applyMatch(match) {
      const updates = [];
      for (const { playerId, displayName } of match.players) {
        const result = resultFor(match, playerId);
        const xpGained = XP_AWARDS[result];
        const { applied, before, after } = await progressAccessor.applyMatchOnce({
          playerId,
          matchId: match.matchId,
          inc: { xp: xpGained, matchesPlayed: 1, [COUNTER_FOR[result]]: 1 },
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
          xpGained,
          leveledUp: levelForXp(after.xp) > levelForXp(before.xp),
          progress: describe(after),
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
     * follows from the XP. Idempotent and resumable.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ moved: Readonly<Record<string, number>> }>} the totals added now
     */
    transferPlayer({ from, to, now }) {
      return progressAccessor.mergeInto({ from, to: to.id, at: now });
    },
  });
}
