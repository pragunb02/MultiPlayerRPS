import { QUEST_COUNTS } from "@classicade/shared";
import { questsFor } from "./questsFor.js";

/**
 * A day of quests for one player, as stored (the snapshot is self-contained, so it means the same thing even
 * after the catalog changes).
 *
 * @typedef {Object} QuestItem
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} counts          QUEST_COUNTS value
 * @property {string | null} gameId
 * @property {number} target
 * @property {number} bonusXp
 * @property {number} progress        0…target
 * @property {number | null} completedAt
 * @property {string[]} seenGames     distinct games played today (for `distinct-games`)
 * @property {number} run             current run of wins today (for `wins-in-a-row`)
 *
 * @typedef {{ playerId: string, day: string, items: ReadonlyArray<Readonly<QuestItem>>, sweepAt: number | null }} QuestDay
 */

/**
 * The day's quests, before any match.
 *
 * @param {{ playerId: string, day: string }} input
 * @returns {Readonly<QuestDay>}
 */
export function newQuestDay({ playerId, day }) {
  const items = questsFor({ playerId, day }).map(
    ({ id, name, description, counts, gameId, target, bonusXp }) =>
      Object.freeze({
        id,
        name,
        description,
        counts,
        gameId,
        target,
        bonusXp,
        progress: 0,
        completedAt: null,
        seenGames: Object.freeze([]),
        run: 0,
      }),
  );
  return Object.freeze({ playerId, day, items: Object.freeze(items), sweepAt: null });
}

/** How one match moves one quest along (before capping at the target). */
function advance(item, { gameId, result }) {
  if (item.gameId !== null && item.gameId !== gameId) {
    return item;
  }
  switch (item.counts) {
    case QUEST_COUNTS.PLAY:
      return result === "forfeit" ? item : { ...item, progress: item.progress + 1 };
    case QUEST_COUNTS.WIN:
      return result === "win" ? { ...item, progress: item.progress + 1 } : item;
    case QUEST_COUNTS.DISTINCT_GAMES: {
      if (result === "forfeit" || item.seenGames.includes(gameId)) {
        return item;
      }
      const seenGames = Object.freeze([...item.seenGames, gameId]);
      return { ...item, seenGames, progress: seenGames.length };
    }
    case QUEST_COUNTS.WINS_IN_A_ROW: {
      if (result === "draw") {
        return item;
      }
      const run = result === "win" ? item.run + 1 : 0;
      return { ...item, run, progress: Math.max(item.progress, run) };
    }
    default:
      throw new RangeError(`Unknown quest count: ${item.counts}`);
  }
}

/**
 * Applies one counted match to the day's quests. Completed quests stay completed; finishing all of them
 * completes the daily sweep.
 *
 * @param {Readonly<QuestDay>} questDay
 * @param {{ gameId: string, result: import("./streaks.js").MatchResult, at: number }} match
 * @returns {Readonly<QuestDay>}
 */
export function applyMatchToQuests(questDay, { gameId, result, at }) {
  const items = questDay.items.map((item) => {
    if (item.completedAt !== null) {
      return item;
    }
    const next = advance(item, { gameId, result });
    const progress = Math.min(next.progress, item.target);
    return Object.freeze({ ...next, progress, completedAt: progress >= item.target ? at : null });
  });
  const allDone = items.every((item) => item.completedAt !== null);
  return Object.freeze({
    ...questDay,
    items: Object.freeze(items),
    sweepAt: questDay.sweepAt ?? (allDone ? at : null),
  });
}
