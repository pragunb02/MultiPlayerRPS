import { levelForXp, MAX_LEVEL, XP_AWARDS, xpForLevel } from "@classicade/shared";
import { isBotPlayerId } from "../../models/botIdentity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import {
  botXpLeftAfter,
  botXpWithdrawnFrom,
  creditFor,
  hasComputerPlayer,
  xpFor,
} from "../matches/fairPlay.js";

/** Events the progression component publishes. */
export const PROGRESSION_EVENTS = Object.freeze({
  /**
   * A player's progress changed: after a match (`key` = matchId), or a quest bonus (`key` = the quest key,
   * `matchId` = ""). Payload: { playerId, displayName, source: "match" | "quest", key, matchId, result?, xpGained,
   * leveledUp, progress, counted, notCountedReason }. A match that didn't count for the player (CC-095) has `counted` false and gives no XP, and
   * `notCountedReason` says why: a NOT_COUNTED_REASONS value, or "" when it counted. After a counted game against
   * a computer character, `botXpLeft` says how much of the day's XP from such games is left (ADR-025). A quest
   * bonus also has `ranked`, which is false when a game against a computer character completed the quest, so the
   * bonus stays off the leaderboards.
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

/**
 * What one counted match adds to a player's totals. `xp` is less than the award past a daily limit (ADR-025). XP from
 * a game against a computer character is also counted as unranked, so leaderboards can leave it out.
 */
const creditOf = (result, xp, unranked) => ({
  xp,
  ...(unranked && { unrankedXp: xp }),
  matchesPlayed: 1,
  [COUNTER_FOR[result]]: 1,
});
const NOTHING = Object.freeze({ xp: 0 });

/**
 * What a guest's game, now the account's, no longer gives: all of it when it stopped counting, or only the XP past
 * the account's daily limit for games against computer characters.
 */
function withdrawnCredit(match, playerId) {
  if (!creditFor(match, playerId).counted) {
    const result = resultFor(match, playerId);
    return creditOf(result, xpFor(match, playerId, XP_AWARDS[result]), hasComputerPlayer(match));
  }
  const xp = botXpWithdrawnFrom(match, playerId);
  return { xp, unrankedXp: xp };
}

/** Adds up totals field by field. */
const addTotals = (total, more) =>
  Object.fromEntries(
    [...new Set([...Object.keys(total), ...Object.keys(more)])].map((key) => [
      key,
      (total[key] ?? 0) + (more[key] ?? 0),
    ]),
  );

/** Level details derived from total XP (what the UI shows as a progress bar). */
function describe({ unrankedXp, ...progress }) {
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
      // A computer character has no progress of its own (ADR-025).
      for (const { playerId, displayName } of match.players.filter((p) => !isBotPlayerId(p.playerId))) {
        const result = resultFor(match, playerId);
        const credit = creditFor(match, playerId);
        // Applied even when it adds nothing, so the player hears why exactly once.
        const inc = credit.counted
          ? creditOf(result, xpFor(match, playerId, XP_AWARDS[result]), hasComputerPlayer(match))
          : NOTHING;
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
          // Only after a game against a computer character: what is left of the day's XP from such games.
          ...Object.fromEntries(botXpLeftAfter(match, playerId).map((left) => ["botXpLeft", left])),
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
     * @param {{ playerId: string, displayName: string, key: string, xp: number, at: number, unranked?: boolean }} bonus
     *   `unranked` is true when a game against a computer character earned the bonus. It then never reaches a
     *   leaderboard (ADR-025). Without it the bonus is ranked
     * @returns {Promise<{ applied: boolean }>}
     */
    async awardBonus({ playerId, displayName, key, xp, at, unranked = false }) {
      const { applied, before, after } = await progressAccessor.applyAwardOnce({
        playerId,
        key,
        inc: { xp, ...(unranked && { unrankedXp: xp }) },
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
          ranked: !unranked,
        });
      }
      return Object.freeze({ applied });
    },

    /** @param {string} playerId */
    async getProgress(playerId) {
      return describe(await progressAccessor.get(playerId));
    },

    /**
     * A guest's XP and totals become their account's (CC-032), added to what the account already has. The level
     * follows from the XP. The games that stopped counting when they moved to the account (it had reached a fair
     * play limit that day, CC-095) are taken out first, so the account never gets more than the limits allow. So is
     * the XP from games against computer characters past the account's own daily limit for them (ADR-025).
     * Runs after the matches moved. Running it again, after a crash or at the same time, adds nothing twice.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ moved: Readonly<Record<string, number>> }>} the totals added now
     */
    async transferPlayer({ from, to, now }) {
      const withdrawn = await matchAccessor.listWithdrawn({ playerId: to.id, from });
      const withdraw = withdrawn.map((match) => withdrawnCredit(match, to.id)).reduce(addTotals, {});
      return progressAccessor.mergeInto({ from, to: to.id, at: now, withdraw });
    },
  });
}
