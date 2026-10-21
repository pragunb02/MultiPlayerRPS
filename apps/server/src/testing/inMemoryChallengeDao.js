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
  const stillOpen = (at, staleBefore) => (doc) =>
    doc.expiresAt > at &&
    (doc.state === CHALLENGE_STATES.OPEN ||
      (doc.state === CHALLENGE_STATES.ACCEPTED && doc.roomCode === "" && doc.endedAt <= staleBefore));

  /** The challenge of `fromId` that holds place `openSlot`, if any (MongoDB: the unique `open_slot` index). */
  const holderOf = (fromId, openSlot) =>
    [...challenges.values()].find((doc) => doc.fromId === fromId && doc.openSlot === openSlot);
  /** Whether a challenge can never be open again at `at` or later. */
  const overFor = (at) => (doc) =>
    doc.expiresAt <= at ||
    doc.state === CHALLENGE_STATES.DECLINED ||
    doc.state === CHALLENGE_STATES.WITHDRAWN ||
    (doc.state === CHALLENGE_STATES.ACCEPTED && doc.roomCode !== "");
  const withoutSlot = ({ openSlot, ...doc }) => doc;

  const dao = Object.freeze({
    ensureIndexes: async () => {},

    async insert(challenge) {
      const taken = (field) => Object.assign(new DuplicateKey(`challenge ${field} taken`), { field });
      if (challenges.has(challenge.challengeId)) throw taken("challengeId");
      if (challenge.openSlot !== undefined && holderOf(challenge.fromId, challenge.openSlot) !== undefined) {
        throw taken("openSlot");
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

    async freeSlots({ fromId, at }) {
      const over = [...challenges.values()].filter(
        (doc) => doc.fromId === fromId && doc.openSlot !== undefined && overFor(at)(doc),
      );
      over.forEach((doc) => challenges.set(doc.challengeId, withoutSlot(doc)));
      return over.length;
    },

    listFrom: async (fromId) => list((doc) => doc.fromId === fromId),
    listTo: async (toId) => list((doc) => doc.toId === toId),

    claim: async ({ challengeId, acceptedBy, acceptedName, at, staleBefore }) =>
      changeIf(challengeId, stillOpen(at, staleBefore), (doc) => ({
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

    end: async ({ challengeId, state, at, staleBefore }) =>
      changeIf(challengeId, stillOpen(at, staleBefore), (doc) => ({
        ...doc,
        state,
        endedAt: at,
        acceptedBy: "",
        acceptedName: "",
      })),

    remove: async (challengeId) => challenges.delete(challengeId),

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
        // A place `to` holds already is not moved (CC-337).
        const keepsSlot =
          doc.fromId !== from || doc.openSlot === undefined || holderOf(to, doc.openSlot) === undefined;
        challenges.set(id, {
          ...(keepsSlot ? doc : withoutSlot(doc)),
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
