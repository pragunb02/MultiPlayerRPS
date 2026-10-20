import { AVATAR_UNLOCKS, getAvatar } from "@classicade/shared";

/**
 * Whether a player may pick an avatar now (CC-034, ADR-065). One check per unlock kind. Coin cosmetics (CC-143) add a
 * kind and its check here, from what the player owns, and nothing else changes. A kind without a check is never
 * unlocked, so a catalogue entry that ships before its check cannot be picked by anyone.
 *
 * @type {Readonly<Record<string, () => boolean>>}
 */
const UNLOCK_CHECKS = Object.freeze({
  [AVATAR_UNLOCKS.FREE]: () => true,
});

/**
 * @param {unknown} avatarId
 * @param {{ find?: typeof getAvatar }} [catalogue]  for tests only, to try entries the catalogue does not have yet
 * @returns {boolean} true only for an avatar in the catalogue, not retired, whose rule lets the player have it
 */
export function canPickAvatar(avatarId, { find = getAvatar } = {}) {
  const avatar = find(avatarId);
  if (avatar === undefined || avatar.retired === true) {
    return false;
  }
  const check = UNLOCK_CHECKS[avatar.unlock.kind];
  return check !== undefined && check();
}
