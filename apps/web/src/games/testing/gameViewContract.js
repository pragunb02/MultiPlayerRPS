import { describe, expect, it } from "vitest";
import { MAX_ACTIONS } from "../../components/MatchShell/matchShell.js";

/**
 * The web side of the game contract (CC-157), like `@classicade/games/testing` is for engines: every entry in
 * GAME_VIEWS must pass the same checks, so the match shell can draw any game. Each field is optional. A field that
 * is there must have the right shape, and the functions must be pure: the same room gives the same answer, and the
 * room is never changed.
 *
 * Run it with `checkGameViewContract` (returns what is wrong) or `describeGameViewContract` (one Vitest test).
 */

const COMPONENTS = Object.freeze(["Options", "Board", "Panel"]);
const FUNCTIONS = Object.freeze(["soundsFor", "reasonPhrase", "actions", "inGameScore"]);
const CONTROL = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const VARIANTS = new Set(["secondary", "ghost"]);
const CONFIRM_FIELDS = Object.freeze(["title", "body", "confirmLabel", "keepLabel"]);

/** A function component, or what `lazy` and `memo` return. */
const isComponent = (value) =>
  typeof value === "function" ||
  (typeof value === "object" && value !== null && typeof value.$$typeof === "symbol");
const filled = (value) => typeof value === "string" && value.trim() !== "";

/** A copy of `value` that nothing can change, so a function that tries throws in strict mode. */
function deepFrozen(value) {
  const copy = structuredClone(value);
  const freeze = (part) => {
    if (part !== null && typeof part === "object") {
      Object.values(part).forEach(freeze);
      Object.freeze(part);
    }
  };
  freeze(copy);
  return copy;
}

/** What is wrong with one action, as sentences. */
function actionProblems(action, where) {
  const problems = [];
  if (!CONTROL.test(action.control ?? ""))
    problems.push(`${where}: control "${action.control}" is not a dotted name`);
  if (!filled(action.label)) problems.push(`${where}: has no label`);
  if (typeof action.reason !== "string") problems.push(`${where}: reason must be a string, "" when allowed`);
  const intent = action.intent ?? {};
  if (intent.type === "move" && (intent.move === null || typeof intent.move !== "object")) {
    problems.push(`${where}: a move intent needs a move object`);
  } else if (intent.type === "ask" && !filled(intent.requestType)) {
    problems.push(`${where}: an ask intent needs a request type`);
  } else if (intent.type !== "move" && intent.type !== "ask") {
    problems.push(`${where}: intent type must be "move" or "ask"`);
  }
  if (action.variant !== undefined && !VARIANTS.has(action.variant)) {
    problems.push(`${where}: variant "${action.variant}" is not one the shell draws`);
  }
  if (action.confirm !== undefined && !CONFIRM_FIELDS.every((field) => filled(action.confirm[field]))) {
    problems.push(`${where}: confirm needs ${CONFIRM_FIELDS.join(", ")}`);
  }
  return problems;
}

/** What is wrong with the actions of `entry` for one room. */
function actionsProblems(entry, room, name) {
  const actions = entry.actions(deepFrozen(room));
  if (!Array.isArray(actions)) return [`actions for ${name} must return a list`];
  const problems = [];
  if (actions.length >= MAX_ACTIONS)
    problems.push(`actions for ${name}: at most ${MAX_ACTIONS - 1} fit beside Leave`);
  const controls = actions.map((action) => action.control);
  if (new Set(controls).size !== controls.length) problems.push(`actions for ${name}: controls repeat`);
  actions.forEach((action, index) =>
    problems.push(...actionProblems(action, `actions for ${name}, #${index + 1}`)),
  );
  if (JSON.stringify(entry.actions(deepFrozen(room))) !== JSON.stringify(actions)) {
    problems.push(`actions for ${name}: the same room gave a different answer`);
  }
  return problems;
}

/** What is wrong with the in-game score of `entry` for one room. */
function scoreProblems(entry, room, name) {
  const score = entry.inGameScore(deepFrozen(room));
  if (score === undefined) return [];
  if (!filled(score?.text)) return [`inGameScore for ${name} must be undefined or { text }`];
  return JSON.stringify(entry.inGameScore(deepFrozen(room))) === JSON.stringify(score)
    ? []
    : [`inGameScore for ${name}: the same room gave a different answer`];
}

/**
 * Everything wrong with a GAME_VIEWS entry, checked against sample rooms of the game. Empty when it passes.
 *
 * @param {{ entry: import("../registry.js").GameViewEntry, rooms: Record<string, any> }} scenario  `rooms`: sample
 *   RoomViews by name, a game that is on for a seated player at least, in which the functions are called
 * @returns {string[]}
 */
export function checkGameViewContract({ entry, rooms }) {
  const problems = [];
  if (!Object.isFrozen(entry)) problems.push("the entry must be frozen");
  for (const field of COMPONENTS) {
    if (entry[field] !== undefined && !isComponent(entry[field])) {
      problems.push(`${field} must be a component`);
    }
  }
  for (const field of FUNCTIONS) {
    if (entry[field] !== undefined && typeof entry[field] !== "function") {
      problems.push(`${field} must be a function`);
    }
  }
  if (entry.requestTexts !== undefined && !Object.isFrozen(entry.requestTexts)) {
    problems.push("requestTexts must be frozen");
  }
  if (problems.length > 0) return problems;
  for (const [name, room] of Object.entries(rooms)) {
    try {
      if (entry.actions !== undefined) problems.push(...actionsProblems(entry, room, name));
      if (entry.inGameScore !== undefined) problems.push(...scoreProblems(entry, room, name));
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
    }
  }
  return problems;
}

/**
 * One Vitest test that the entry passes the contract.
 *
 * @param {string} gameId
 * @param {{ entry: import("../registry.js").GameViewEntry, rooms: Record<string, any> }} scenario
 */
export function describeGameViewContract(gameId, scenario) {
  describe(`${gameId} plugs into the match shell (CC-157)`, () => {
    it("follows the GameViewEntry contract", () => {
      expect(checkGameViewContract(scenario)).toEqual([]);
    });
  });
}
