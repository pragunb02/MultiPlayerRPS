import { DuplicateKey } from "../persistence/errors.js";

const copy = (doc) => structuredClone(doc);
const newestFirst = (a, b) => b.createdAt - a.createdAt;

/** Test double with the same contract as `createFriendshipDao` (verified by the shared contract tests). */
export function createInMemoryFriendshipDao() {
  /** @type {Map<string, object>} friendships by pair */
  const pairs = new Map();
  const keyOf = ({ low, high }) => `${low} ${high}`;
  const involving = (playerId) =>
    [...pairs.values()].filter((doc) => doc.low === playerId || doc.high === playerId);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(friendship) {
      if (pairs.has(keyOf(friendship))) {
        throw new DuplicateKey(`${friendship.low} and ${friendship.high} are friends already`);
      }
      pairs.set(keyOf(friendship), copy(friendship));
      return copy(friendship);
    },

    listFor: async (playerId) =>
      involving(playerId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(copy),
    countFor: async (playerId) => involving(playerId).length,
    exists: async (pair) => pairs.has(keyOf(pair)),
    deletePair: async (pair) => Number(pairs.delete(keyOf(pair))),

    async deleteInvolving(playerId) {
      const gone = involving(playerId);
      gone.forEach((doc) => pairs.delete(keyOf(doc)));
      return gone.length;
    },
  });
}

/** Test double with the same contract as `createFriendRequestDao` (verified by the shared contract tests). */
export function createInMemoryFriendRequestDao() {
  /** @type {Map<string, object>} requests by request id */
  const requests = new Map();
  const find = (test) => [...requests.values()].filter(test);
  const live = (doc, now) => doc.expiresAt > now;
  const one = (doc, what) => {
    if (doc === undefined) throw new RangeError(`No friend request ${what}`);
    return copy(doc);
  };
  const remove = (docs) => {
    docs.forEach((doc) => requests.delete(doc.requestId));
    return docs.length;
  };

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(request) {
      const taken = find(
        (doc) => doc.senderId === request.senderId && doc.recipientId === request.recipientId,
      );
      if (taken.length > 0 || requests.has(request.requestId)) {
        throw new DuplicateKey(`${request.senderId} asked ${request.recipientId} already`);
      }
      requests.set(request.requestId, copy(request));
      return copy(request);
    },

    getByPair: async ({ senderId, recipientId }) =>
      one(
        find((doc) => doc.senderId === senderId && doc.recipientId === recipientId)[0],
        `from ${senderId} to ${recipientId}`,
      ),

    async getLive({ requestId, now }) {
      const doc = requests.get(requestId);
      return one(doc !== undefined && live(doc, now) ? doc : undefined, requestId);
    },

    async update({ requestId, statuses, set }) {
      const doc = requests.get(requestId);
      if (doc === undefined || !statuses.includes(doc.status)) return 0;
      requests.set(requestId, { ...doc, ...copy(set) });
      return 1;
    },

    listSentBy: async ({ senderId, statuses, now }) =>
      find((doc) => doc.senderId === senderId && statuses.includes(doc.status) && live(doc, now))
        .sort(newestFirst)
        .map(copy),

    listSentTo: async ({ recipientId, statuses, now, limit }) =>
      find((doc) => doc.recipientId === recipientId && statuses.includes(doc.status) && live(doc, now))
        .sort(newestFirst)
        .slice(0, limit)
        .map(copy),

    deleteBetween: async ({ a, b }) =>
      remove(
        find(
          (doc) =>
            (doc.senderId === a && doc.recipientId === b) || (doc.senderId === b && doc.recipientId === a),
        ),
      ),

    deleteInvolving: async (playerId) =>
      remove(find((doc) => doc.senderId === playerId || doc.recipientId === playerId)),
  });
}

/** Test double with the same contract as `createFriendLinkDao` (verified by the shared contract tests). */
export function createInMemoryFriendLinkDao() {
  /** @type {Map<string, object>} links by token hash */
  const links = new Map();
  const liveOne = (tokenHash, now) => {
    const doc = links.get(tokenHash);
    if (doc === undefined || doc.expiresAt <= now)
      throw new RangeError("No such friend link, or it stopped working");
    return doc;
  };
  const byCreator = (creatorId) =>
    [...links.values()].filter((doc) => doc.creatorId === creatorId).sort(newestFirst);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert(link) {
      if (links.has(link.tokenHash)) throw new DuplicateKey("That token is taken");
      links.set(link.tokenHash, copy(link));
      return copy(link);
    },

    getLive: async ({ tokenHash, now }) => copy(liveOne(tokenHash, now)),

    async take({ tokenHash, now }) {
      const doc = liveOne(tokenHash, now);
      links.delete(tokenHash);
      return copy(doc);
    },

    listBy: async ({ creatorId, now }) =>
      byCreator(creatorId)
        .filter((doc) => doc.expiresAt > now)
        .map(copy),

    async keepNewest({ creatorId, keep }) {
      const older = byCreator(creatorId).slice(keep);
      older.forEach((doc) => links.delete(doc.tokenHash));
      return older.length;
    },

    async deleteBy(creatorId) {
      const gone = byCreator(creatorId);
      gone.forEach((doc) => links.delete(doc.tokenHash));
      return gone.length;
    },
  });
}

/** Test double with the same contract as `createPrivacyDao` (verified by the shared contract tests). */
export function createInMemoryPrivacyDao() {
  /** @type {Map<string, object>} switches by player id */
  const players = new Map();

  return Object.freeze({
    ensureIndexes: async () => {},

    findByPlayers: async (playerIds) =>
      [...new Set(playerIds)].filter((id) => players.has(id)).map((id) => copy(players.get(id))),

    async set({ playerId, appearOffline, updatedAt }) {
      players.set(playerId, { playerId, appearOffline, updatedAt });
      return copy(players.get(playerId));
    },

    deleteByPlayer: async (playerId) => Number(players.delete(playerId)),
  });
}
