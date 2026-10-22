import { FLAGS } from "@classicade/shared";

/** Every flag the web app may read, asked for in one request. */
export const CLIENT_FLAG_NAMES = Object.freeze(FLAGS.filter((flag) => flag.client).map((flag) => flag.name));

/**
 * How long the app waits for the answer. After that every flag is off for this person until the page reloads, so a
 * page that waits for the answer before drawing what a flag changes never waits longer than this.
 */
export const FLAG_ANSWER_MS = 3_000;

const PENDING = "pending";
const stores = new WeakMap();

/**
 * The app's one cache of flag answers (CC-349). The app asks for every client flag once per person, as soon as it
 * knows who the person is, and every `useFlagState` reads the cached answer. So a page that downloads later has its
 * answer when it first draws, and nothing on it moves when the answer comes. A failed or late question answers off,
 * and an answer that comes after that is not used, so a flag never turns on under the player's eyes.
 *
 * There is one store per API client, so the whole app (and each test, with its own fake client) shares one.
 *
 * @param {{ getFlags: (names: ReadonlyArray<string>) => Promise<Record<string, boolean>> }} api
 */
export function flagStoreFor(api) {
  if (!stores.has(api)) stores.set(api, createFlagStore(api));
  return stores.get(api);
}

function createFlagStore(api) {
  /** @type {Map<string, Record<string, boolean> | typeof PENDING>} */
  const answers = new Map();
  const listeners = new Set();
  const timers = new Map();

  function settle(who, flags) {
    if (answers.get(who) !== PENDING) return;
    clearTimeout(timers.get(who));
    answers.set(who, flags);
    listeners.forEach((listener) => listener());
  }

  return Object.freeze({
    /**
     * Asks for this person's flags, unless they were asked already.
     *
     * @param {string} who  the player id, or "" for a visitor
     */
    load(who) {
      if (answers.has(who)) return;
      answers.set(who, PENDING);
      timers.set(
        who,
        setTimeout(() => settle(who, {}), FLAG_ANSWER_MS),
      );
      api.getFlags(CLIENT_FLAG_NAMES).then(
        (flags) => settle(who, flags),
        () => settle(who, {}),
      );
    },
    /**
     * @param {string} who
     * @param {string} name
     * @returns {"unknown" | "on" | "off"} a FLAG_STATES value
     */
    stateOf(who, name) {
      const flags = answers.get(who);
      if (flags === undefined || flags === PENDING) return "unknown";
      return flags[name] === true ? "on" : "off";
    },
    /**
     * @param {() => void} listener  told whenever an answer comes
     * @returns {() => void} stops telling it
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
