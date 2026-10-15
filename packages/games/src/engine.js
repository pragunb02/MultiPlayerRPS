/**
 * The contract every game implements. The server is authoritative: it calls these pure functions and
 * never trusts a client's idea of the game. Adding a game = implementing this contract and registering it.
 *
 * Rules for implementations (checked by the shared contract tests in `@classicade/games/testing`):
 * - Pure: no I/O, no timers, no Math.random/Date.now — randomness and time arrive as arguments.
 * - Never mutate inputs; return new state.
 * - State, views and outcomes are plain JSON-serialisable data (they are persisted and broadcast).
 * - `validateMove` never throws, whatever the client sends; it returns a rejection instead.
 *
 * @typedef {string} PlayerId
 *
 * @typedef {Object} MoveContext
 * @property {number} now   current server time in ms (for clocks/timeouts), passed in to keep engines pure
 *
 * @typedef {{ status: "ongoing" }
 *   | { status: "finished", result: "win" | "draw", winners: PlayerId[], reason: string }} Outcome
 *
 * @template State, Move, Options
 * @typedef {Object} GameEngine
 * @property {string} id                                     matches a GAME_IDS value
 * @property {{ min: number, max: number }} players          how many players a game needs
 * @property {(raw: unknown) => import("./result.js").Result<Options>} validateOptions
 * @property {(setup: { players: PlayerId[], options: Options, rng: import("./rng.js").Rng }) => State} init
 * @property {(state: State, playerId: PlayerId, raw: unknown, ctx: MoveContext) => import("./result.js").Result<Move>} validateMove
 * @property {(state: State, playerId: PlayerId, move: Move, ctx: MoveContext) => State} applyMove
 * @property {(state: State) => Outcome} getOutcome
 * @property {(state: State, viewer: PlayerId | "spectator") => unknown} viewFor   hides what the viewer may not see
 * @property {(state: State) => PlayerId[]} activePlayers                         who may move right now
 */

const REQUIRED_FUNCTIONS = [
  "validateOptions",
  "init",
  "validateMove",
  "applyMove",
  "getOutcome",
  "viewFor",
  "activePlayers",
];
const MAX_PLAYERS = 8;

/**
 * Checks an engine against the contract's shape and freezes it. A malformed engine fails when it is
 * defined (at import/boot), not in the middle of a game.
 *
 * @template E
 * @param {E} engine
 * @returns {Readonly<E>}
 */
export function defineEngine(engine) {
  const problems = [];
  if (typeof engine?.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(engine.id)) {
    problems.push("id must be a lowercase identifier");
  }
  const { min, max } = engine?.players ?? {};
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > MAX_PLAYERS || min > max) {
    problems.push(`players must be { min, max } integers with 1 <= min <= max <= ${MAX_PLAYERS}`);
  }
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof engine?.[name] !== "function") {
      problems.push(`${name} must be a function`);
    }
  }
  if (problems.length > 0) {
    throw new TypeError(`Invalid game engine "${engine?.id}": ${problems.join("; ")}`);
  }
  return Object.freeze({ ...engine, players: Object.freeze({ min, max }) });
}
