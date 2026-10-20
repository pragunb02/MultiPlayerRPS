import { CHALLENGE_STATES } from "@classicade/shared";
import { DuplicateKey } from "../persistence/errors.js";

const PLAYER_FIELDS = Object.freeze(["fromId", "toId", "acceptedBy"]);

/** Test double with the same contract as `createChallengeDao` (verified by the shared contract tests). */
export function createInMemoryChallengeDao() {
  /** @type {Map<string, object>} records by challenge id */
  const challenges = new Map();
  const copy = (doc) => structuredClone(doc);
  const newestFirst = (a, b) => b.createdAt - a.createdAt;
  const list = (test) => [...challenges.values()].filter(test).sort(newestFirst).map(copy);
  /** Applies `update` to the record when `test` holds for it. Answers whether it did. */
  const changeIf = (challengeId, test, update) => {
    const doc = challenges.get(challengeId);
    if (doc === undefined || !test(doc)) return false;
    challenges.set(challengeId, update(doc));
    return true;
  };
  const stillOpen = (at) => (doc) => doc.state === CHALLENGE_STATES.OPEN && doc.expiresAt > at;

  const dao = Object.freeze({
    ensureIndexes: async () => {},

    async insert(challenge) {
      if (challenges.has(challenge.challengeId)) {
        throw new DuplicateKey(`challenge ${challenge.challengeId} exists`);
      }
      challenges.set(challenge.challengeId, {
        toId: "",
        toName: "",
        options: {},
        acceptedBy: "",
        acceptedName: "",
        roomCode: "",
        laterBy: [],
        ...copy(challenge),
      });
      return dao.get(challenge.challengeId);
    },

    async get(challengeId) {
      const doc = challenges.get(challengeId);
      if (doc === undefined) {
        throw new RangeError(`no challenge ${challengeId}`);
      }
      return copy(doc);
    },

    listFrom: async (fromId) => list((doc) => doc.fromId === fromId),
    listTo: async (toId) => list((doc) => doc.toId === toId),

    claim: async ({ challengeId, acceptedBy, acceptedName, at }) =>
      changeIf(challengeId, stillOpen(at), (doc) => ({
        ...doc,
        state: CHALLENGE_STATES.ACCEPTED,
        acceptedBy,
        acceptedName,
        endedAt: at,
      })),

    release: async ({ challengeId, acceptedBy }) =>
      changeIf(
        challengeId,
        (doc) =>
          doc.state === CHALLENGE_STATES.ACCEPTED && doc.acceptedBy === acceptedBy && doc.roomCode === "",
        ({ endedAt, ...doc }) => ({ ...doc, state: CHALLENGE_STATES.OPEN, acceptedBy: "", acceptedName: "" }),
      ),

    setRoom: async ({ challengeId, acceptedBy, roomCode }) =>
      changeIf(
        challengeId,
        (doc) =>
          doc.state === CHALLENGE_STATES.ACCEPTED && doc.acceptedBy === acceptedBy && doc.roomCode === "",
        (doc) => ({ ...doc, roomCode }),
      ),

    end: async ({ challengeId, state, at }) =>
      changeIf(challengeId, stillOpen(at), (doc) => ({ ...doc, state, endedAt: at })),

    addLater: async ({ challengeId, playerId }) =>
      changeIf(
        challengeId,
        (doc) => !doc.laterBy.includes(playerId),
        (doc) => ({ ...doc, laterBy: [...doc.laterBy, playerId] }),
      ),

    async movePlayer({ from, to }) {
      let moved = 0;
      for (const [id, doc] of challenges) {
        const fields = PLAYER_FIELDS.filter((field) => doc[field] === from);
        const later = doc.laterBy.includes(from);
        if (fields.length === 0 && !later) continue;
        moved += fields.length + (later ? 1 : 0);
        challenges.set(id, {
          ...doc,
          ...Object.fromEntries(fields.map((field) => [field, to])),
          laterBy: doc.laterBy.map((playerId) => (playerId === from ? to : playerId)),
        });
      }
      return moved;
    },

    async deleteInvolving(playerId) {
      const gone = [...challenges.values()].filter((doc) =>
        PLAYER_FIELDS.some((field) => doc[field] === playerId),
      );
      gone.forEach((doc) => challenges.delete(doc.challengeId));
      return gone.length;
    },
  });
  return dao;
}
