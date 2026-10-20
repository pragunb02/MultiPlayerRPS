/**
 * The avatars a player can pick (CC-034, ADR-065). Each is our own drawing in the web app (`apps/web/src/art/avatars`),
 * never an upload or a photo. The server keeps only the id.
 *
 * Every avatar has an unlock rule. Today every rule is `free`. Coin cosmetics (CC-143, ADR-026) add a rule kind here
 * and its check on the server, and the picker, the rooms and the boards keep working unchanged. An id is permanent:
 * a retired avatar stays in the list with `retired: true`, so a player who picked it keeps it, and nobody new can
 * pick it.
 */

/** The kinds of unlock rule. CC-143 adds more, such as coins or a level. */
export const AVATAR_UNLOCKS = Object.freeze({ FREE: "free" });

/**
 * @typedef {Object} AvatarInfo
 * @property {string} id       permanent, lower case words with hyphens
 * @property {string} name     what the picture shows, read out by screen readers
 * @property {Readonly<{ kind: string }>} unlock   who may pick it, one of `AVATAR_UNLOCKS`
 * @property {boolean} [retired]   kept for those who have it, never offered again
 */

const free = (id, name) => Object.freeze({ id, name, unlock: Object.freeze({ kind: AVATAR_UNLOCKS.FREE }) });

/** @type {ReadonlyArray<Readonly<AvatarInfo>>} in the order the picker shows them */
export const AVATARS = Object.freeze([
  free("bolt", "Lightning bolt"),
  free("rocket", "Rocket"),
  free("robot", "Robot"),
  free("cat", "Cat"),
  free("fox", "Fox"),
  free("owl", "Owl"),
  free("crown", "Crown"),
  free("planet", "Ringed planet"),
  free("dice", "Dice"),
  free("knight", "Chess knight"),
  free("cactus", "Cactus"),
  free("comet", "Comet"),
]);

const BY_ID = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));

/**
 * @param {unknown} id
 * @returns {Readonly<AvatarInfo> | undefined}
 */
export const getAvatar = (id) => (typeof id === "string" ? BY_ID.get(id) : undefined);

/** Whether a value is the id of an avatar in the catalogue, retired ones included. @param {unknown} id */
export const isAvatarId = (id) => getAvatar(id) !== undefined;
