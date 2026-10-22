import { useEffect, useState } from "react";
import { gameView } from "../../games/registry.js";

const NO_STEPS = Object.freeze([]);
/** The steps each game has loaded on this page, so a second page that shows them has them at once. */
const loaded = new Map();

/**
 * A game's How to play steps, loaded through its registry entry's `loadHowToPlay` (CC-349), so a new game brings
 * its steps with its one registry entry. Undefined while they load. A game with no steps, or whose steps could not
 * load, has none, and its pages show no How to play.
 *
 * @param {string} gameId
 * @returns {ReadonlyArray<import("../../games/howToPlay.js").HowToPlayStep> | undefined}
 */
export function useHowToPlay(gameId) {
  const load = gameView(gameId).loadHowToPlay;
  const [answer, setAnswer] = useState({ gameId: "", steps: NO_STEPS });

  useEffect(() => {
    if (load === undefined || loaded.has(gameId)) return undefined;
    let cancelled = false;
    load().then(
      (steps) => {
        loaded.set(gameId, steps);
        if (!cancelled) setAnswer({ gameId, steps });
      },
      () => !cancelled && setAnswer({ gameId, steps: NO_STEPS }),
    );
    return () => {
      cancelled = true;
    };
  }, [gameId, load]);

  if (load === undefined) return NO_STEPS;
  return loaded.get(gameId) ?? (answer.gameId === gameId ? answer.steps : undefined);
}
