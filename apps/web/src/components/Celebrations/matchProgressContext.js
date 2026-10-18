import { createContext, useContext } from "react";

/**
 * The last `progress:updated` of each recent match of the signed-in player, oldest first. Provided by
 * <MatchProgressProvider>.
 */
export const MatchProgressContext = createContext(null);

/** How many matches are kept. A player is in a few rooms at most, and a result only needs its own match. */
export const KEPT_MATCHES = 10;

/**
 * The kept updates with one more push. Only match pushes are kept, because a quest bonus belongs to no match. A
 * second push for the same match replaces the first, and the oldest match goes once more than KEPT_MATCHES are kept.
 *
 * @param {ReadonlyArray<{ matchId: string }>} kept
 * @param {{ source: string, matchId: string }} update   a `progress:updated` payload
 * @returns {ReadonlyArray<{ matchId: string }>}
 */
export function keepMatchUpdate(kept, update) {
  if (update.source !== "match") {
    return kept;
  }
  const others = kept.filter(({ matchId }) => matchId !== update.matchId);
  return Object.freeze([...others, Object.freeze({ ...update })].slice(-KEPT_MATCHES));
}

/**
 * The progress update the server sent for one match, or undefined while it has not come yet. It also finds an
 * update that came before the caller was on screen (CC-235).
 *
 * @param {string} matchId
 */
export function useMatchProgress(matchId) {
  const kept = useContext(MatchProgressContext);
  if (kept === null) {
    throw new Error("useMatchProgress must be used inside <MatchProgressProvider>");
  }
  return kept.find((update) => update.matchId === matchId);
}
