/**
 * Friends (CC-052, ADR-066). Friends are mutual and for accounts only. A friend is named by their profile handle
 * (ADR-065), a request by a random id, and a friend link by a random token. None of them is a player id.
 */

/** What a friend sees of another friend: on the site, in a game, or neither. Never which room or which game. */
export const FRIEND_PRESENCE = Object.freeze({ ONLINE: "online", PLAYING: "playing", OFFLINE: "offline" });

/** How a request came about: the two played together, or the sender opened the other player's friend link. */
export const FRIEND_REQUEST_VIA = Object.freeze({ GAME: "game", LINK: "link" });

/** The answers to a friend request. "decline" is the page's "Not now", and the sender is never told. */
export const FRIEND_ANSWERS = Object.freeze({ ACCEPT: "accept", DECLINE: "decline" });

/**
 * What sending a request did. `sent` is also the answer when the other player blocked the sender, declined earlier
 * or never looks, so a block reads exactly like any other request (ADR-053). `friends` means the other player had
 * asked first, so the two are friends now.
 */
export const FRIEND_REQUEST_RESULTS = Object.freeze({ SENT: "sent", FRIENDS: "friends" });

/** A friend link's token: 22 base64url characters, 128 random bits. A player id never has this shape. */
export const FRIEND_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** @param {unknown} value */
export const isFriendLinkToken = (value) => typeof value === "string" && FRIEND_LINK_TOKEN_PATTERN.test(value);

/**
 * The numbers players can be told (ADR-066.8). The page says them in its words, and the server enforces them.
 *
 * 1. `maxFriends`: friends one player can have.
 * 2. `maxWaiting`: requests one player can have waiting for an answer.
 * 3. `requestDays`: days a request waits before it runs out.
 * 4. `linkDays`: days a friend link works, and it works once.
 */
export const FRIEND_RULES = Object.freeze({ maxFriends: 200, maxWaiting: 10, requestDays: 30, linkDays: 7 });
