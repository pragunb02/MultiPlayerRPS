import { FLAG_AUDIENCES, FLAG_ROLLOUT, IDENTITY_KINDS } from "@classicade/shared";

/**
 * Who gets a feature flag, as pure rules (CC-312, ADR-073). A bucket comes from a keyed id of the flag and the
 * player, so each flag splits players in its own way, and the same player is always in the same bucket for a flag.
 */

/** How many buckets a flag has. A whole percent is 100 of them, which leaves room for hundredths later. */
export const BUCKETS = 10_000;
const PER_PERCENT = BUCKETS / 100;

/**
 * The bucket a keyed id falls in: its first 4 bytes as a number, modulo the number of buckets. The id is an HMAC,
 * so its bytes are even, and the remainder favours low buckets by less than one in a million.
 *
 * @param {string} keyedId  `keyedIds.idOf([flagName, playerId])` under the FLAG_BUCKETS label
 * @returns {number} from 0 to BUCKETS minus 1
 */
export const bucketFrom = (keyedId) => Buffer.from(keyedId, "base64url").readUInt32BE(0) % BUCKETS;

/**
 * Whether a bucket is inside a rollout. A percentage takes the lowest buckets, so raising it only adds players and
 * lowering it only removes them. A visitor with no id has no bucket, and gets the flag only when it is on.
 *
 * @param {{ rollout: import("@classicade/shared/src/flags.js").FlagRollout, bucket: number | undefined }} input
 * @returns {boolean}
 */
export function inRollout({ rollout, bucket }) {
  if (rollout === FLAG_ROLLOUT.ON) return true;
  if (rollout === FLAG_ROLLOUT.OFF || bucket === undefined) return false;
  return bucket < Number(rollout) * PER_PERCENT;
}

/**
 * @typedef {{ id: string, kind: string, admin: boolean }} FlagPlayer   who is asking: the session's identity and
 *   whether the console allowlist has them. `undefined` is a visitor with no session yet
 */

/**
 * Whether a player is in a flag's audience.
 *
 * @param {{ audience: string, player: FlagPlayer | undefined, adult: boolean }} input  `adult` is the age rule's
 *   answer for this player (CC-152), asked only for the adults audience
 * @returns {boolean}
 * @throws {RangeError} for an audience not in FLAG_AUDIENCES
 */
export function inAudience({ audience, player, adult }) {
  switch (audience) {
    case FLAG_AUDIENCES.EVERYONE:
      return true;
    case FLAG_AUDIENCES.SIGNED_IN:
      return player?.kind === IDENTITY_KINDS.USER;
    case FLAG_AUDIENCES.ADULTS:
      return player?.kind === IDENTITY_KINDS.USER && adult;
    case FLAG_AUDIENCES.ADMINS:
      return player?.admin === true;
    default:
      throw new RangeError(`Unknown flag audience "${audience}"`);
  }
}
