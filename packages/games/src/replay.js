import { createSeededRng } from "./rng.js";

/**
 * Rebuilds a game from its setup and action log. Engines always give the same result for the same input, so the
 * seed, the options and the log together reproduce the exact final state. Match history, replays and audits rely
 * on this.
 *
 * Every logged move is re-validated (with the time it was played), so a tampered log cannot be replayed
 * into a result the rules would not allow.
 *
 * @param {Readonly<import("./engine.js").GameEngine<any, any, any>>} engine
 * @param {{
 *   players: string[],
 *   options: unknown,
 *   seed: number,
 *   log: ReadonlyArray<{ kind: string, playerId?: string, move?: unknown, at: number }>,
 * }} game
 * @returns {unknown} the final engine state
 * @throws {Error} when the log contains a move the rules reject, or an unknown entry
 */
export function replayGame(engine, { players, options, seed, log }) {
  let state = engine.init({ players: [...players], options, rng: createSeededRng(seed) });
  log.forEach((entry, index) => {
    const ctx = { now: entry.at };
    switch (entry.kind) {
      case "move": {
        const validated = engine.validateMove(state, entry.playerId, entry.move, ctx);
        if (!validated.ok) {
          throw new Error(
            `Log entry ${index} is not a legal move (${validated.reason}: ${validated.message})`,
          );
        }
        state = engine.applyMove(state, entry.playerId, validated.value, ctx);
        break;
      }
      case "expire":
        if (engine.expire === undefined) {
          throw new Error(`Log entry ${index}: ${engine.id} has no time hooks`);
        }
        state = engine.expire(state, ctx);
        break;
      case "forfeit":
        // A forfeit ends the match outside the rules of the game. The board itself stays as it was.
        break;
      default:
        throw new Error(`Log entry ${index} has unknown kind "${entry.kind}"`);
    }
  });
  return state;
}
