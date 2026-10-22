import { assertFunction } from "../../utils/assert.js";

/** Have I Been Pwned's Pwned Passwords range API (https://haveibeenpwned.com/API/v3#PwnedPasswords). No key needed. */
export const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** How long one range request may take, reading the answer included (ADR-080). */
export const PWNED_PASSWORDS_TIMEOUT_MS = 1500;

/** How many hex characters of a password's SHA-1 are sent, the k-anonymity prefix of the range API (ADR-080). */
export const PWNED_PASSWORDS_PREFIX_LENGTH = 5;

const PREFIX = new RegExp(`^[0-9A-F]{${PWNED_PASSWORDS_PREFIX_LENGTH}}$`);
const LINE = /^([0-9A-F]{35}):(\d+)$/;

/**
 * A fetch for a process that must not use the network, such as the tests and the browser tests. It always fails,
 * so the check behaves as when the service cannot be reached.
 *
 * @returns {Promise<Response>}
 */
export async function NO_NETWORK_FETCH() {
  throw new Error("no network in this process: the Pwned Passwords range API is not asked");
}

/**
 * Asks Have I Been Pwned which password hashes share a prefix (CC-261, ADR-080). Only the first five hex
 * characters of a SHA-1 are sent. The answer lists every known suffix with that prefix and how often it was seen.
 * `Add-Padding: true` asks for extra suffixes with a count of 0, so the size of the answer says nothing about the
 * prefix to anyone watching the network.
 *
 * @param {{ fetch: typeof globalThis.fetch, timeoutMs?: number }} deps  `fetch` is injected so tests never touch
 *   the network. `timeoutMs` stays at 1.5 s outside tests
 */
export function createPwnedPasswordsClient({ fetch, timeoutMs = PWNED_PASSWORDS_TIMEOUT_MS }) {
  assertFunction(fetch, "fetch");

  return Object.freeze({
    /**
     * The suffixes of one prefix with their counts. Padding suffixes are included with a count of 0.
     *
     * @param {string} prefix  the first five characters of an upper case SHA-1 in hex
     * @returns {Promise<ReadonlyMap<string, number>>}
     * @throws {RangeError} for a prefix that is not five upper case hex digits
     * @throws {Error} when the network fails, the answer is late or not 200, or a line cannot be read
     */
    async rangeOf(prefix) {
      if (!PREFIX.test(prefix)) {
        throw new RangeError("A range prefix is five upper case hex digits");
      }
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error(`Pwned Passwords timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
      try {
        const response = await fetch(`${PWNED_PASSWORDS_RANGE_URL}${prefix}`, {
          headers: { "Add-Padding": "true", "User-Agent": "ClassiCade" },
          signal: controller.signal,
        });
        if (response.status !== 200) {
          throw new Error(`Pwned Passwords answered ${response.status}`);
        }
        return parseRange(await response.text());
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

/** @param {string} text the range answer, one `SUFFIX:COUNT` per line */
function parseRange(text) {
  const range = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    const match = LINE.exec(line);
    if (match === null) {
      throw new Error("Pwned Passwords answered an unexpected line");
    }
    range.set(match[1], Number(match[2]));
  }
  return range;
}
