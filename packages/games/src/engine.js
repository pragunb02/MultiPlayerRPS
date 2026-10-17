/**
 * The contract every game implements. The server decides what happens in a game: it calls these pure functions
 * and never trusts a client's idea of the game. To add a game, implement this contract and register the engine.
 *
 * Rules for implementations (checked by the shared contract tests in `@classicade/games/testing`):
 * 1. Pure: no I/O, no timers, no `Math.random` or `Date.now`. Randomness and time arrive as arguments.
 * 2. Never change the inputs. Return new state instead.
 * 3. State, views and outcomes are plain data that survives JSON, because they are stored and sent to clients.
 * 4. `validateMove` never throws, whatever the client sends. It returns a rejection instead.
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
 * @property {(state: State) => number} [deadline]
 *   Optional time hook: the time (ms timestamp) when something happens if nobody acts, for example when a
 *   chess player runs out of time. 0 means "no deadline". It is worked out from the state alone. The server
 *   sets the timer, the engine never does.
 * @property {(state: State, ctx: MoveContext) => State} [expire]
 *   Optional, but required together with `deadline`. Applies the timed event once `ctx.now >= deadline(state)`.
 */

const OPTIONAL_TIME_HOOKS = ["deadline", "expire"];

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
  const timeHooks = OPTIONAL_TIME_HOOKS.filter((name) => engine?.[name] !== undefined);
  if (timeHooks.length > 0 && !OPTIONAL_TIME_HOOKS.every((name) => typeof engine[name] === "function")) {
    problems.push("deadline and expire must be provided together, as functions");
  }
  if (problems.length > 0) {
    throw new TypeError(`Invalid game engine "${engine?.id}": ${problems.join("; ")}`);
  }
  return Object.freeze({ ...engine, players: Object.freeze({ min, max }) });
}
