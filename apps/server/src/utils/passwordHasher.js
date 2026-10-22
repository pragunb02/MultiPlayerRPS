import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with Node's built-in scrypt (no native dependency). Each hash records its own
 * parameters — `scrypt$<N>$<r>$<p>$<salt>$<hash>` (base64) — so they can be raised later and existing
 * hashes upgraded transparently at the next successful login (`needsRehash`).
 *
 * The default is OWASP's alternative minimum, N = 2^15, r = 8, p = 3 (CC-260, ADR-080). Memory is 128 * N * r, so
 * 32 MiB per hash whatever p is, which fits Render's 512 MB. Node runs the three lanes one after another, so a hash
 * takes about three times as long as with p = 1. OWASP's first option, N = 2^17 with p = 1, needs 128 MiB per hash,
 * too much when a few logins arrive together. Hashes made before keep their own parameters, still verify, and are
 * made again at the next successful login.
 */
export const DEFAULT_SCRYPT_PARAMS = Object.freeze({ N: 2 ** 15, r: 8, p: 3 });
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// Stored parameters are trusted only within these bounds, so a corrupt hash can't demand gigabytes of memory.
const MAX_STORED_N = 2 ** 20;
const MAX_STORED_R_P = 16;

const scryptAsync = promisify(scrypt);
const derive = (password, salt, { N, r, p }) =>
  scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });

const isPowerOfTwo = (n) => Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
const plausible = ({ N, r, p }) =>
  isPowerOfTwo(N) &&
  N <= MAX_STORED_N &&
  [r, p].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_STORED_R_P);

function parse(encoded) {
  const [scheme, N, r, p, salt, hash] = String(encoded).split("$");
  if (scheme !== "scrypt" || !salt || !hash) {
    return undefined;
  }
  return {
    params: { N: Number(N), r: Number(r), p: Number(p) },
    salt: Buffer.from(salt, "base64"),
    hash: Buffer.from(hash, "base64"),
  };
}

/**
 * @param {{ params?: { N: number, r: number, p: number } }} [options]  tests pass cheap params for speed
 */
export function createPasswordHasher({ params = DEFAULT_SCRYPT_PARAMS } = {}) {
  const hash = async (password) => {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, params);
    return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join(
      "$",
    );
  };

  // Hash of a random password, verified against when an account does not exist, so a login for an unknown
  // email costs the same time as one for a real account (no timing-based account discovery).
  const dummy = hash(randomBytes(32).toString("hex"));

  return Object.freeze({
    hash,

    /**
     * Constant-time check. A malformed stored hash never matches.
     *
     * @param {string} password
     * @param {string} encoded
     */
    async verify(password, encoded) {
      const parsed = parse(encoded);
      if (parsed === undefined || !plausible(parsed.params)) {
        return false;
      }
      const key = await derive(password, parsed.salt, parsed.params);
      return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
    },

    /** Spends the same effort as a real verification and always fails. */
    async verifyAgainstDummy(password) {
      await this.verify(password, await dummy);
      return false;
    },

    /** True when a stored hash uses weaker parameters than the current ones. */
    needsRehash(encoded) {
      const parsed = parse(encoded);
      return (
        parsed === undefined ||
        parsed.params.N < params.N ||
        parsed.params.r !== params.r ||
        parsed.params.p !== params.p
      );
    },
  });
}
