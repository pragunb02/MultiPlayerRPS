import { levelForXp, MAX_LEVEL, XP_AWARDS, xpForLevel } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";

/** Events the progression component publishes. */
export const PROGRESSION_EVENTS = Object.freeze({
  /** { playerId, matchId, xpGained, leveledUp, progress } — a player's progress changed after a match */
  UPDATED: "progression.updated",
});

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
      for (const { playerId } of match.players) {
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

    /** @param {string} playerId */
    async getProgress(playerId) {
      return describe(await progressAccessor.get(playerId));
    },
  });
}
