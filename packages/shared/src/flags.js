/**
 * Feature flags (CC-312, ADR-073). Every flag is written once, here, and reviewed in a pull request: what it is
 * for, the ticket that owns it, who may get it, how far it is rolled out when nobody has changed it, the one event
 * that says it worked, and the day it must be removed by. The owner changes only the rollout, from the console.
 * The server works out who gets a flag. The web app only ever learns `true` or `false` for a flag it asks about.
 *
 * How a feature ships behind a flag is in docs/PROCESS.md.
 */

/** A rollout is off, on, or a whole percentage of players from 0 to 100. */
export const FLAG_ROLLOUT = Object.freeze({ OFF: "off", ON: "on" });

/** Who may get a flag at all. A player outside the audience never gets it, whatever the rollout. */
export const FLAG_AUDIENCES = Object.freeze({
  /** Anyone, visitors included. A visitor with no guest or account yet gets it only when it is on for everyone. */
  EVERYONE: "everyone",
  /** Players with an account. */
  SIGNED_IN: "signed-in",
  /** Accounts whose birth year makes them surely 18 (CC-152, ADR-028). Unknown age is not adult. */
  ADULTS: "adults",
  /** The accounts allowed into the owner console (ADR-036). */
  ADMINS: "admins",
});

/** The two sides of a flag, as the counts name them. */
export const FLAG_SIDES = Object.freeze({ ON: "on", OFF: "off" });

/**
 * @typedef {"off" | "on" | number} FlagRollout
 *
 * @typedef {Object} FeatureFlag
 * @property {string} name          snake case, the name code and the console use
 * @property {string} description   what the flag changes, in plain words, for the console
 * @property {string} ticket        the ticket that owns it, such as CC-312
 * @property {false} default        what a player gets when the flag cannot be worked out. Always off
 * @property {string} removeBy      the India day, YYYY-MM-DD, by which the flag and its old path are deleted
 * @property {FlagRollout} rollout  the rollout when the owner has not set one
 * @property {string} audience      one of FLAG_AUDIENCES
 * @property {boolean} client       whether the web app may ask for its answer. This file ships in the web bundle and
 *   the repository is public, so a name or a description is never a secret
 * @property {string} success       the one event that says the feature worked, in plain words
 */

/** @type {ReadonlyArray<Readonly<FeatureFlag>>} */
export const FLAGS = Object.freeze([
  Object.freeze({
    name: "console_flag_check",
    description:
      "Shows a line on the console's Flags page saying this flag is on for you, so the owner can check a rollout end to end before a real feature uses one.",
    ticket: "CC-312",
    default: false,
    removeBy: "2026-12-31",
    rollout: FLAG_ROLLOUT.OFF,
    audience: FLAG_AUDIENCES.ADMINS,
    client: true,
    success: "The owner pressed It works on that line.",
  }),
  Object.freeze({
    name: "telemetry_ingest",
    description:
      "The server keeps anonymous usage counts sent to POST /api/telemetry and records its own (sign-ups, logins, errors). Off drops every batch, and the answer is the same 204 either way.",
    ticket: "CC-175",
    default: false,
    removeBy: "2027-01-31",
    rollout: FLAG_ROLLOUT.OFF,
    audience: FLAG_AUDIENCES.EVERYONE,
    client: false,
    success: "A batch with at least one event stored.",
  }),
  Object.freeze({
    name: "telemetry_client",
    description:
      "The browser counts pages, presses, dead and rage clicks, errors, connection changes and page speed, with no id, and sends them to our own server. Never with the privacy switch off, Global Privacy Control or Do Not Track.",
    ticket: "CC-174",
    default: false,
    removeBy: "2027-01-31",
    rollout: FLAG_ROLLOUT.OFF,
    audience: FLAG_AUDIENCES.EVERYONE,
    client: true,
    success: "A batch the server accepted (204).",
  }),
]);

const NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const TICKET = /^CC-\d{3,}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AUDIENCES = new Set(Object.values(FLAG_AUDIENCES));

const isDay = (value) =>
  typeof value === "string" &&
  DAY.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Whether a value is a rollout: `"off"`, `"on"`, or a whole number from 0 to 100.
 *
 * @param {unknown} value
 * @returns {value is FlagRollout}
 */
export const isRollout = (value) =>
  value === FLAG_ROLLOUT.OFF ||
  value === FLAG_ROLLOUT.ON ||
  (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100);

/** What is wrong with one flag, as a list of field names. */
const problemsOf = (flag) =>
  [
    ["name", NAME.test(flag.name ?? "")],
    ["description", isText(flag.description)],
    ["ticket", TICKET.test(flag.ticket ?? "")],
    ["default", flag.default === false],
    ["removeBy", isDay(flag.removeBy)],
    ["rollout", isRollout(flag.rollout)],
    ["audience", AUDIENCES.has(flag.audience)],
    ["client", typeof flag.client === "boolean"],
    ["success", isText(flag.success)],
  ]
    .filter(([, ok]) => !ok)
    .map(([field]) => field);

/**
 * Checks a registry: every flag well formed and every name used once. The server runs it at boot, so a broken
 * registry never ships.
 *
 * @param {ReadonlyArray<Readonly<FeatureFlag>>} flags
 * @throws {Error} naming the flag and the fields that are wrong
 */
export function assertFlagRegistry(flags) {
  flags.forEach((flag) => {
    const problems = problemsOf(flag);
    if (problems.length > 0) {
      throw new Error(`Feature flag "${flag.name}" has a bad ${problems.join(", ")}`);
    }
  });
  const names = flags.map(({ name }) => name);
  const twice = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  if (twice.length > 0) {
    throw new Error(`Feature flags named twice: ${twice.join(", ")}`);
  }
}

/**
 * The flags whose removal day is before today. Due today is not yet overdue.
 *
 * @param {ReadonlyArray<Readonly<FeatureFlag>>} flags
 * @param {string} today  the India day, YYYY-MM-DD
 */
export const overdueFlags = (flags, today) => flags.filter(({ removeBy }) => removeBy < today);

/**
 * A flag the web app may read. A server-only flag is not, so the server never answers a browser about it.
 *
 * @param {Readonly<FeatureFlag>} flag
 * @returns {Readonly<FeatureFlag>} the same flag
 * @throws {RangeError} for a flag not marked `client`
 */
export function assertClientFlag(flag) {
  if (!flag.client) {
    throw new RangeError(`Feature flag "${flag.name}" is not marked client, so the web app cannot read it`);
  }
  return flag;
}

const BY_NAME = new Map(FLAGS.map((flag) => [flag.name, flag]));

/**
 * Whether a name is a registered flag.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export const isFlagName = (name) => typeof name === "string" && BY_NAME.has(name);

/**
 * The registered flag of a name. An unknown name is a mistake in code, so it throws rather than reading as off.
 *
 * @param {string} name
 * @returns {Readonly<FeatureFlag>}
 * @throws {RangeError} for a name that is not in FLAGS
 */
export function flagNamed(name) {
  const flag = BY_NAME.get(name);
  if (flag === undefined) {
    throw new RangeError(`Unknown feature flag "${name}". Add it to packages/shared/src/flags.js first.`);
  }
  return flag;
}
