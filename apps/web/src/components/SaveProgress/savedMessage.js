import { SAVE_WORTHY_XP } from "./saveProgressContext.js";

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * Whether signing up or logging in brought a guest's games along (CC-032: `carriedOver` is only there when
 * something moved, and a guest who never finished a match moves nothing worth announcing).
 *
 * @param {{ xp: number, matchesPlayed: number } | undefined} carriedOver
 */
export const movedAnything = (carriedOver) =>
  carriedOver !== undefined && (carriedOver.xp > 0 || carriedOver.matchesPlayed > 0);

/**
 * The one confirmation after a guest's progress moved to the account, with the account's numbers now.
 *
 * @param {{ level: number, xp: number, matchesPlayed: number }} progress
 */
export const savedMessage = ({ level, xp, matchesPlayed }) =>
  `Your progress is now saved: Level ${level} · ${xp} XP · ${plural(matchesPlayed, "match", "matches")}`;

/** When the account's progress can't be read right after signing in: still true, just without numbers. */
export const SAVED_WITHOUT_NUMBERS = "Your progress is now saved.";

/**
 * Whether a guest's win is a moment to offer saving: their first win, or any win once they have built up some XP.
 *
 * @param {{ wins: number, xp: number }} progress  after the win
 */
export const winWorthSaving = ({ wins, xp }) => wins === 1 || xp >= SAVE_WORTHY_XP;
