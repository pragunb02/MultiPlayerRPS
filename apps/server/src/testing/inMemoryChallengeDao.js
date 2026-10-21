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

  /**
   * Which unique key of another record `doc` would break, if any: a place of its sender (MongoDB: the `open_slot`
   * index) or a mark of a recent one to its person (the `recent_to` index).
   */
  const clashOf = (doc) => {
    const others = [...challenges.values()].filter(
      (other) => other.challengeId !== doc.challengeId && other.fromId === doc.fromId,
    );
    if (doc.openSlot !== undefined && others.some((other) => other.openSlot === doc.openSlot))
      return "openSlot";
    if (doc.recentTo !== undefined && others.some((other) => other.recentTo && other.toId === doc.toId)) {
      return "recentTo";
    }
    return undefined;
  };
  /** Whether a challenge can never be open again at `at` or later. */
  const overFor = (at) => (doc) =>
    doc.expiresAt <= at ||
    doc.state === CHALLENGE_STATES.DECLINED ||
    doc.state === CHALLENGE_STATES.WITHDRAWN ||
    (doc.state === CHALLENGE_STATES.ACCEPTED && doc.roomCode !== "");
  const withoutSlot = ({ openSlot, ...doc }) => doc;
  const withoutMark = ({ recentTo, ...doc }) => doc;

  const dao = Object.freeze({
    ensureIndexes: async () => {},

    async insert(challenge) {
      const taken = (field) => Object.assign(new DuplicateKey(`challenge ${field} taken`), { field });
      if (challenges.has(challenge.challengeId)) throw taken("challengeId");
      const clash = clashOf({ toId: "", ...challenge });
      if (clash !== undefined) throw taken(clash);
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

    async freeSlots({ fromId, at, recentBefore }) {
      const mine = [...challenges.values()].filter((doc) => doc.fromId === fromId);
      const over = mine.filter((doc) => doc.openSlot !== undefined && overFor(at)(doc));
      over.forEach((doc) => challenges.set(doc.challengeId, withoutSlot(challenges.get(doc.challengeId))));
      const old = mine.filter((doc) => doc.recentTo !== undefined && doc.createdAt <= recentBefore);
      old.forEach((doc) => challenges.set(doc.challengeId, withoutMark(challenges.get(doc.challengeId))));
      return over.length + old.length;
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
        let next = {
          ...doc,
          ...Object.fromEntries(fields.map((field) => [field, to])),
          laterBy: doc.laterBy.map((playerId) => (playerId === from ? to : playerId)),
        };
        // A place or mark `to` holds already is given up: the mark first, then the place (CC-337).
        if (clashOf(next) !== undefined) next = withoutMark(next);
        if (clashOf(next) !== undefined) next = withoutSlot(next);
        challenges.set(id, next);
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
