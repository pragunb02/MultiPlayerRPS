import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Object} Friendship   domain model (frozen, times in ms): the player is friends with `friendId`
 * @property {string} friendId
 * @property {number} since
 *
 * @typedef {Object} FriendRequest   domain model (frozen, times in ms): one player asked another (CC-052)
 * @property {string} requestId       random, the only id of a request a client ever sees
 * @property {string} senderId
 * @property {string} recipientId
 * @property {string} via              a FRIEND_REQUEST_VIA value
 * @property {string} status           a FRIEND_REQUEST_STATUS value
 * @property {number} createdAt        when it was last sent
 * @property {number} notifiedAt       when the recipient was last told about it
 * @property {number} expiresAt
 * @property {number} [declinedAt]     when it was declined, or kept from its recipient. It stays declined until it
 *   runs out, even when its sender cancels it and sends it again
 *
 * @typedef {Object} FriendLink   domain model (frozen, times in ms): a link a player made, known by its token's hash
 * @property {string} tokenHash
 * @property {string} creatorId
 * @property {number} createdAt
 * @property {number} expiresAt
 */

/** Where a request stands. Only the sender and the server ever tell `declined` from `pending`, and the sender never does. */
export const FRIEND_REQUEST_STATUS = Object.freeze({
  PENDING: "pending",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
  /** Claimed by its recipient's accept, for the moment before the pair's requests are deleted. */
  ACCEPTED: "accepted",
});

/** The two ids of a pair in the order they are stored, so each pair has one record whoever asked. */
const ordered = (a, b) => (a < b ? { low: a, high: b } : { low: b, high: a });

const DATE_FIELDS = Object.freeze(["createdAt", "notifiedAt", "expiresAt", "declinedAt"]);

/** A persistence object with its dates as times in ms, frozen. */
const timed = (doc) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(doc).map(([key, value]) => [key, DATE_FIELDS.includes(key) ? value.getTime() : value]),
    ),
  );
const toDates = (fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, DATE_FIELDS.includes(key) ? new Date(value) : value]),
  );
const timedAll = (docs) => Object.freeze(docs.map(timed));

/** Runs a read that throws RangeError for nothing found, and says NotFoundError instead. */
async function found(read, message) {
  try {
    return timed(await read());
  } catch (err) {
    if (err instanceof RangeError) throw new NotFoundError(message, { cause: err });
    throw err;
  }
}

/**
 * Provides friendships, friend requests and friend links to the domain (CC-052, ADR-066).
 *
 * @param {{
 *   friendshipDao: ReturnType<typeof import("../persistence/friendshipDao.js").createFriendshipDao>,
 *   friendRequestDao: ReturnType<typeof import("../persistence/friendRequestDao.js").createFriendRequestDao>,
 *   friendLinkDao: ReturnType<typeof import("../persistence/friendLinkDao.js").createFriendLinkDao>,
 * }} deps
 */
export function createFriendAccessor({ friendshipDao, friendRequestDao, friendLinkDao }) {
  assertDefined(friendshipDao, "friendshipDao");
  assertDefined(friendRequestDao, "friendRequestDao");
  assertDefined(friendLinkDao, "friendLinkDao");

  return Object.freeze({
    /**
     * Makes two players friends, or changes nothing when they are already.
     *
     * @param {{ a: string, b: string, at: number }} pair
     * @returns {Promise<boolean>} whether they became friends now
     */
    async befriend({ a, b, at }) {
      try {
        await friendshipDao.insert({ ...ordered(a, b), createdAt: new Date(at) });
        return true;
      } catch (err) {
        if (err instanceof DuplicateKey) return false;
        throw err;
      }
    },

    /** @param {{ a: string, b: string }} pair @returns {Promise<boolean>} */
    areFriends: ({ a, b }) => friendshipDao.exists(ordered(a, b)),

    /**
     * @param {string} playerId
     * @returns {Promise<ReadonlyArray<Readonly<Friendship>>>} oldest friendship first
     */
    async friendsOf(playerId) {
      const docs = await friendshipDao.listFor(playerId);
      return Object.freeze(
        docs.map((doc) =>
          Object.freeze({
            friendId: doc.low === playerId ? doc.high : doc.low,
            since: doc.createdAt.getTime(),
          }),
        ),
      );
    },

    /** @param {string} playerId @returns {Promise<number>} */
    countFriends: (playerId) => friendshipDao.countFor(playerId),

    /** @param {{ a: string, b: string }} pair @returns {Promise<boolean>} whether they were friends */
    unfriend: async ({ a, b }) => (await friendshipDao.deletePair(ordered(a, b))) > 0,

    /**
     * Stores a request, or answers the one the sender already has to that player, whatever its status.
     *
     * @param {FriendRequest} request
     * @returns {Promise<{ created: boolean, request: Readonly<FriendRequest> }>}
     */
    async addRequest(request) {
      try {
        const doc = await friendRequestDao.insert(toDates(request));
        return { created: true, request: timed(doc) };
      } catch (err) {
        if (!(err instanceof DuplicateKey)) throw err;
        const { senderId, recipientId } = request;
        return {
          created: false,
          request: timed(await friendRequestDao.getByPair({ senderId, recipientId })),
        };
      }
    },

    /**
     * The request one player sent the other, even one that ran out a moment ago.
     *
     * @param {{ senderId: string, recipientId: string }} pair
     * @returns {Promise<Readonly<FriendRequest>>}
     * @throws {NotFoundError} when there is none
     */
    getRequest: (pair) => found(() => friendRequestDao.getByPair(pair), "No such friend request"),

    /**
     * @param {{ requestId: string, now: number }} query
     * @returns {Promise<Readonly<FriendRequest>>}
     * @throws {NotFoundError} when there is none, or it ran out
     */
    getLiveRequest: ({ requestId, now }) =>
      found(() => friendRequestDao.getLive({ requestId, now: new Date(now) }), "No such friend request"),

    /**
     * Changes a request only while it has one of `statuses`.
     *
     * @param {{ requestId: string, statuses: ReadonlyArray<string>, set: Partial<Omit<FriendRequest, "requestId" | "senderId" | "recipientId">> }} change
     * @returns {Promise<boolean>} whether it changed
     */
    updateRequest: async ({ requestId, statuses, set }) =>
      (await friendRequestDao.update({ requestId, statuses, set: toDates(set) })) > 0,

    /**
     * @param {{ senderId: string, statuses: ReadonlyArray<string>, now: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<FriendRequest>>>} newest first, none that ran out
     */
    sentBy: async ({ senderId, statuses, now }) =>
      timedAll(await friendRequestDao.listSentBy({ senderId, statuses, now: new Date(now) })),

    /**
     * @param {{ recipientId: string, statuses: ReadonlyArray<string>, now: number, limit: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<FriendRequest>>>} newest first, none that ran out
     */
    sentTo: async ({ recipientId, statuses, now, limit }) =>
      timedAll(await friendRequestDao.listSentTo({ recipientId, statuses, now: new Date(now), limit })),

    /**
     * Declines every pending request between two players, either way, as a block does.
     *
     * @param {{ a: string, b: string, at: number }} pair
     * @returns {Promise<number>} requests declined
     */
    declineRequestsBetween: ({ a, b, at }) => friendRequestDao.declineBetween({ a, b, at: new Date(at) }),

    /** @param {{ a: string, b: string }} pair @returns {Promise<number>} requests removed, either way */
    removeRequestsBetween: (pair) => friendRequestDao.deleteBetween(pair),

    /**
     * @param {FriendLink} link
     * @returns {Promise<Readonly<FriendLink>>}
     * @throws {import("../persistence/errors.js").DuplicateKey} when the token is taken, which a random token never is
     */
    addLink: async (link) => timed(await friendLinkDao.insert(toDates(link))),

    /**
     * @param {{ tokenHash: string, now: number }} query
     * @returns {Promise<Readonly<FriendLink>>}
     * @throws {NotFoundError} when there is none, or it stopped working
     */
    getLiveLink: ({ tokenHash, now }) =>
      found(() => friendLinkDao.getLive({ tokenHash, now: new Date(now) }), "No such friend link"),

    /**
     * Takes a link out, so nobody can use it again.
     *
     * @param {{ tokenHash: string, now: number }} query
     * @returns {Promise<Readonly<FriendLink>>}
     * @throws {NotFoundError} when there is none, it stopped working or someone took it a moment ago
     */
    takeLink: ({ tokenHash, now }) =>
      found(() => friendLinkDao.take({ tokenHash, now: new Date(now) }), "No such friend link"),

    /**
     * @param {{ creatorId: string, now: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<FriendLink>>>} newest first, only those that still work
     */
    linksBy: async ({ creatorId, now }) =>
      timedAll(await friendLinkDao.listBy({ creatorId, now: new Date(now) })),

    /** @param {{ creatorId: string, keep: number }} input @returns {Promise<number>} older links removed */
    keepNewestLinks: (input) => friendLinkDao.keepNewest(input),

    /**
     * Deletes every friendship, request and link of the player, on either side.
     *
     * @param {string} playerId
     * @returns {Promise<{ friendships: number, friendRequests: number, friendLinks: number }>}
     */
    removeInvolving: async (playerId) => ({
      friendships: await friendshipDao.deleteInvolving(playerId),
      friendRequests: await friendRequestDao.deleteInvolving(playerId),
      friendLinks: await friendLinkDao.deleteBy(playerId),
    }),
  });
}
