import { CHALLENGE_STATES } from "@classicade/shared";
import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Object} Challenge     domain model (frozen, times in ms): one challenge (CC-139, ADR-069)
 * @property {string} challengeId   random id, the id in its link
 * @property {string} fromId        the player who made it
 * @property {string} fromName      their display name when they made it
 * @property {boolean} fromPublic   whether that name may be shown to anyone with the link
 * @property {string} toId          the one player it is for, "" for a link anyone may take
 * @property {string} toName        their display name, "" for a link anyone may take
 * @property {string} gameId
 * @property {Readonly<object>} options
 * @property {string} state         as stored: open, accepted, declined or withdrawn. Expired comes from the time
 * @property {number} createdAt
 * @property {number} expiresAt
 * @property {number} endedAt       0 while nobody has answered it
 * @property {string} acceptedBy    "" until someone takes it
 * @property {string} acceptedName  "" until someone takes it
 * @property {string} roomCode      "" until its room is made
 * @property {ReadonlyArray<string>} laterBy  the players who moved it to their inbox
 */

/** @returns {Readonly<Challenge>} The place and mark it holds (`openSlot`, `recentTo`) stay in storage. */
const toChallenge = ({
  createdAt,
  expiresAt,
  endedAt,
  deleteAt,
  openSlot,
  recentTo,
  options,
  laterBy,
  ...doc
}) =>
  Object.freeze({
    ...doc,
    options: Object.freeze({ ...options }),
    createdAt: createdAt.getTime(),
    expiresAt: expiresAt.getTime(),
    endedAt: endedAt === undefined ? 0 : endedAt.getTime(),
    laterBy: Object.freeze([...laterBy]),
  });
const toChallenges = (docs) => Object.freeze(docs.map(toChallenge));

/**
 * Provides challenges to the domain (CC-139, ADR-069).
 *
 * @param {{ challengeDao: ReturnType<typeof import("../persistence/challengeDao.js").createChallengeDao> }} deps
 */
export function createChallengeAccessor({ challengeDao }) {
  assertDefined(challengeDao, "challengeDao");

  return Object.freeze({
    /**
     * Stores a new open challenge in one of the sender's `openSlots` places for open challenges, and, for one to a
     * person, as the sender's one recent challenge to them for `recentMs`. Both hold however many are made at the
     * same moment (CC-337). Places of challenges that can never be open again, and marks older than `recentMs`, are
     * let go first.
     *
     * @param {Omit<Challenge, "state" | "endedAt" | "acceptedBy" | "acceptedName" | "roomCode" | "laterBy"> & { deleteAt: number }} challenge
     *   `deleteAt` is when storage forgets it by itself
     * @param {{ openSlots: number, recentMs: number }} limits
     * @returns {Promise<Readonly<Challenge>>}
     * @throws {ConflictError} with `details.field` "openSlot" when every place is held, or "recentTo" when the
     *   sender challenged the same person less than `recentMs` ago
     */
    async add({ createdAt, expiresAt, deleteAt, ...challenge }, { openSlots, recentMs }) {
      await challengeDao.freeSlots({
        fromId: challenge.fromId,
        at: new Date(createdAt),
        recentBefore: new Date(createdAt - recentMs),
      });
      for (let openSlot = 0; openSlot < openSlots; openSlot += 1) {
        try {
          return toChallenge(
            await challengeDao.insert({
              ...challenge,
              state: CHALLENGE_STATES.OPEN,
              createdAt: new Date(createdAt),
              expiresAt: new Date(expiresAt),
              deleteAt: new Date(deleteAt),
              openSlot,
              ...(challenge.toId !== "" && { recentTo: true }),
            }),
          );
        } catch (err) {
          if (!(err instanceof DuplicateKey) || err.field === "challengeId") throw err;
          if (err.field === "recentTo") {
            throw new ConflictError("A challenge to them is recent", {
              details: { field: "recentTo" },
              cause: err,
            });
          }
        }
      }
      throw new ConflictError("Every place for an open challenge is taken", {
        details: { field: "openSlot", openSlots },
      });
    },

    /**
     * @param {string} challengeId
     * @returns {Promise<Readonly<Challenge>>}
     * @throws {NotFoundError} when there is none, or storage has forgotten it
     */
    async get(challengeId) {
      try {
        return toChallenge(await challengeDao.get(challengeId));
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
        throw new NotFoundError("No such challenge", { cause: err });
      }
    },

    /** @param {string} playerId @returns {Promise<ReadonlyArray<Readonly<Challenge>>>} newest first */
    listFrom: async (playerId) => toChallenges(await challengeDao.listFrom(playerId)),

    /** @param {string} playerId @returns {Promise<ReadonlyArray<Readonly<Challenge>>>} newest first */
    listTo: async (playerId) => toChallenges(await challengeDao.listTo(playerId)),

    /**
     * @param {{ challengeId: string, acceptedBy: string, acceptedName: string, at: number, staleBefore: number }} claim
     *   a hold that began before `staleBefore` with no room counts as open
     */
    claim: ({ at, staleBefore, ...claim }) =>
      challengeDao.claim({ ...claim, at: new Date(at), staleBefore: new Date(staleBefore) }),

    /** @param {{ challengeId: string, acceptedBy: string }} claim */
    release: (claim) => challengeDao.release(claim),

    /** @param {{ challengeId: string, acceptedBy: string, roomCode: string }} room */
    setRoom: (room) => challengeDao.setRoom(room),

    /** @param {{ challengeId: string, state: string, at: number, staleBefore: number }} end */
    end: ({ at, staleBefore, ...end }) =>
      challengeDao.end({ ...end, at: new Date(at), staleBefore: new Date(staleBefore) }),

    /** @param {string} challengeId @returns {Promise<boolean>} whether it was there */
    remove: (challengeId) => challengeDao.remove(challengeId),

    /** @param {{ challengeId: string, playerId: string }} later */
    addLater: (later) => challengeDao.addLater(later),

    /** @param {{ from: string, to: string }} transfer @returns {Promise<number>} */
    movePlayer: (transfer) => challengeDao.movePlayer(transfer),

    /** @param {string} playerId @returns {Promise<number>} */
    removeInvolving: (playerId) => challengeDao.deleteInvolving(playerId),
  });
}
