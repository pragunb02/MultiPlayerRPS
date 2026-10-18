import { createHmac, randomBytes } from "node:crypto";

const NAME_LENGTH = 16;
const DAY_MS = 24 * 60 * 60 * 1000;
// A timer may fire a moment before midnight. Waiting at least this long before the next try means it can never
// fire over and over in that moment.
const MIN_WAIT_MS = 1000;

const dayOf = (time) => Math.floor(time / DAY_MS);

/**
 * @typedef {Readonly<{ name: string, earlier: ReadonlyArray<string> }>} NetworkNames  `name` is what a new room
 *   stores. `earlier` holds the name the same address had under yesterday's key, when there is one, so rooms opened
 *   before midnight still count for the cap per network
 */

/**
 * Names a network address without storing it. Rooms keep the name, so the rooms opened from one network can be
 * counted (CC-107), while the database never holds anyone's address.
 *
 * There are few enough addresses that anyone holding the key could hash every one of them and find the address
 * behind a name. So the key is 32 random bytes made in this process for each UTC day and never written anywhere
 * (CC-249). A day's key names new rooms during that day. During the next day it is kept only to count the rooms
 * opened under it, and at the following midnight it is dropped. After that, nobody can turn that day's names back
 * into addresses, not from the database, a backup or any of the server's settings. A restart forgets every key,
 * so rooms still open from before a restart stop counting for the cap per network. Those rooms close within a day,
 * and the other limits still hold meanwhile.
 *
 * @param {{ now: () => number, randomKey?: () => Buffer }} options  `now` is the server clock. `randomKey` makes a
 *   day's key, and tests replace it to see when a new one is made
 */
export function createNetworkKey({ now, randomKey = () => randomBytes(32) }) {
  if (typeof now !== "function") {
    throw new TypeError("createNetworkKey needs a clock");
  }
  /** @type {Map<number, Buffer>} a UTC day's number to its key: today's and yesterday's at most */
  const keys = new Map();
  const nameWith = (key, address) =>
    createHmac("sha256", key).update(address).digest("hex").slice(0, NAME_LENGTH);

  function dropOldKeys() {
    const today = dayOf(now());
    for (const day of keys.keys()) {
      if (day < today - 1 || day > today) keys.delete(day);
    }
  }

  return Object.freeze({
    /**
     * Works out the names of an address now. Call it when a room is created, not when a socket connects, so a
     * socket kept open past midnight still gets today's name.
     *
     * @param {string} address  a rate limit key, such as `ip:203.0.113.7`
     * @returns {NetworkNames}
     */
    networkOf(address) {
      dropOldKeys();
      const today = dayOf(now());
      if (!keys.has(today)) keys.set(today, randomKey());
      const yesterday = keys.get(today - 1);
      return Object.freeze({
        name: nameWith(keys.get(today), address),
        earlier: Object.freeze(yesterday === undefined ? [] : [nameWith(yesterday, address)]),
      });
    },

    /** Drops every key from before yesterday, so a quiet night does not keep one longer than it should. */
    dropOldKeys,

    /** @returns {number} how many days' keys are held, so tests can see old ones go */
    days: () => keys.size,
  });
}

/**
 * Drops old network keys at every UTC midnight, so the key of a day is gone at the second midnight after it even
 * when nobody opens a room. The timer does not keep the process alive.
 *
 * @param {{ networkKey: { dropOldKeys: () => void }, now: () => number }} deps
 * @returns {{ stop: () => void }}
 */
export function dropOldNetworkKeysEveryMidnight({ networkKey, now }) {
  /** @type {ReturnType<typeof setTimeout>} */
  let timer;
  const arm = () => {
    const untilMidnight = DAY_MS - (now() % DAY_MS);
    timer = setTimeout(
      () => {
        networkKey.dropOldKeys();
        arm();
      },
      Math.max(MIN_WAIT_MS, untilMidnight),
    );
    timer.unref();
  };
  arm();
  return { stop: () => clearTimeout(timer) };
}
