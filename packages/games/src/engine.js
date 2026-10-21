import { ROOM_REQUEST_TYPES } from "@classicade/shared";

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
 * @property {(setup: { players: PlayerId[], options: Options, rng: import("./rng.js").Rng, starter?: PlayerId }) => State} init
 *   `starter` is given only to an engine with `starterOf`, for a rematch (CC-091). Without it the engine draws who
 *   starts from `rng`, as it always has
 * @property {(state: State, playerId: PlayerId, raw: unknown, ctx: MoveContext) => import("./result.js").Result<Move>} validateMove
 * @property {(state: State, playerId: PlayerId, move: Move, ctx: MoveContext) => State} applyMove
 * @property {(state: State) => Outcome} getOutcome
 * @property {(state: State, viewer: PlayerId | "spectator") => unknown} viewFor   hides what the viewer may not see
 * @property {(state: State) => PlayerId[]} activePlayers                         who may move right now
 * @property {(state: State) => PlayerId[]} playersOf
 *   every player of the game, in seat order. Anyone the state, a view or the outcome names is one of them, so the
 *   server can rename all of them before a view leaves it (CC-253). The contract kit checks that no view names
 *   anyone else
 * @property {(state: State) => number} [deadline]
 *   Optional time hook: the time (ms timestamp) when something happens if nobody acts, for example when a
 *   chess player runs out of time. 0 means "no deadline". It is worked out from the state alone. The server
 *   sets the timer, the engine never does.
 * @property {(state: State, ctx: MoveContext) => State} [expire]
 *   Optional, but required together with `deadline`. Applies the timed event once `ctx.now >= deadline(state)`.
 * @property {number} [turnLimitMs]
 *   Optional idle limit (CC-036): how long a player due to move may take once they have made their first move.
 *   The room ends the game when it passes. Games with their own clock (chess) leave it out.
 * @property {(state: State) => PlayerId} [starterOf]
 *   Optional, for games where one player moves first (CC-091). Who moved first in this game. An engine with this
 *   hook also takes a `starter` in `init` and lets that player move first, so a rematch can give the first move to
 *   the other player
 * @property {Readonly<Record<string, RequestType>>} [requestTypes]
 *   Optional requests a player of this game may send the other during play (CC-159), such as a draw offer. The
 *   room keeps them, so they expire, cool down and are answered the same way in every game.
 * @property {(state: State, request: { type: string, from: PlayerId, to: PlayerId }, ctx: MoveContext) => State} [acceptRequest]
 *   Optional, but required together with `requestTypes`. What accepting one of those requests does to the game.
 *   `defineEngine` makes it throw for any other type, so an engine never has to check the type itself.
 *
 * @typedef {Object} RequestType
 * @property {number} lifetimeMs       how long the request stays open without an answer
 * @property {number} limitPerPlayer   how many times one player may ask in one game
 */

const OPTIONAL_TIME_HOOKS = ["deadline", "expire"];
/** Request types the room itself offers. A game may not add one with the same name. */
const ROOM_REQUEST_NAMES = new Set(Object.values(ROOM_REQUEST_TYPES));

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

/** What is wrong with an engine's optional request hooks, as a list of problems. */
function requestProblems(engine) {
  const { requestTypes, acceptRequest } = engine;
  if (requestTypes === undefined && acceptRequest === undefined) {
    return [];
  }
  if (typeof acceptRequest !== "function" || requestTypes === null || typeof requestTypes !== "object") {
    return ["requestTypes and acceptRequest must be provided together"];
  }
  return Object.entries(requestTypes).flatMap(([type, rule]) => {
    if (ROOM_REQUEST_NAMES.has(type)) {
      return [`request type ${type} belongs to the room`];
    }
    return isPositiveInteger(rule?.lifetimeMs) && isPositiveInteger(rule?.limitPerPlayer)
      ? []
      : [`request type ${type} needs a positive lifetimeMs and limitPerPlayer`];
  });
}

/**
 * The request hooks of a checked engine. Request types come from a player, so the rules sit in an object without a
 * prototype: a type such as "constructor" finds nothing instead of what every object inherits. Accepting a type
 * the game did not declare throws, whatever the engine's own `acceptRequest` would have done with it.
 */
function ownRequestHooks(engine) {
  const requestTypes = Object.freeze(
    Object.assign(
      Object.create(null),
      Object.fromEntries(
        Object.entries(engine.requestTypes).map(([type, rule]) => [type, Object.freeze({ ...rule })]),
      ),
    ),
  );
  const accept = engine.acceptRequest;
  const acceptRequest = (state, request, ctx) => {
    if (!Object.hasOwn(requestTypes, request.type)) {
      throw new TypeError(`${engine.id} has no request type "${request.type}"`);
    }
    return accept(state, request, ctx);
  };
  return { requestTypes, acceptRequest };
}

const REQUIRED_FUNCTIONS = [
  "validateOptions",
  "init",
  "validateMove",
  "applyMove",
  "getOutcome",
  "viewFor",
  "activePlayers",
  "playersOf",
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
  if (engine?.starterOf !== undefined && typeof engine.starterOf !== "function") {
    problems.push("starterOf must be a function");
  }
  if (engine?.turnLimitMs !== undefined && !isPositiveInteger(engine.turnLimitMs)) {
    problems.push("turnLimitMs must be a positive number of milliseconds");
  }
  problems.push(...requestProblems(engine ?? {}));
  if (problems.length > 0) {
    throw new TypeError(`Invalid game engine "${engine?.id}": ${problems.join("; ")}`);
  }
  const requestHooks = engine.requestTypes === undefined ? {} : ownRequestHooks(engine);
  return Object.freeze({ ...engine, ...requestHooks, players: Object.freeze({ min, max }) });
}
