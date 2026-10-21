import { randomIndex } from "./rng.js";

/**
 * Who moves first in a new game. A rematch names the starter (CC-091). Without one the starter is drawn from the
 * seeded random numbers, so game 1 of a room and every game recorded before CC-091 start as they always did.
 *
 * @param {{ players: ReadonlyArray<string>, rng: import("./rng.js").Rng, starter?: string }} setup  the engine's
 *   `init` setup, with `starter` left out when nobody is named
 * @returns {string} one of `players`
 * @throws {TypeError} when the named starter is not one of the players
 */
export function chooseStarter({ players, rng, starter }) {
  if (starter === undefined) {
    return players[randomIndex(rng, players.length)];
  }
  if (!players.includes(starter)) {
    throw new TypeError("The starter must be one of the players");
  }
  return starter;
}
