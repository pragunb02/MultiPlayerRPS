import { CHALLENGE_STATES } from "@classicade/shared";
import { assertDefined } from "../utils/assert.js";
import { NotFoundError } from "../utils/errors.js";

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
 * @property {string} groupId       an invite's group (CC-052): the challenge whose record decides who plays. Its own id
 *   for a link, and for a record made before CC-052
 * @property {string} filledBy      on the first of a group, the invite whose friend plays, "" while nobody
 * @property {boolean} filledDone   on the first of a group, that invite's room is made
 * @property {number} keptAt        when the friend who took it kept it for later, 0 if never
 */

/** @returns {Readonly<Challenge>} */
const toChallenge = ({
  createdAt,
  expiresAt,
  endedAt,
  deleteAt,
  options,
  laterBy,
  groupId,
  filledBy,
  filledDone,
  keptAt,
  ...doc
}) =>
  Object.freeze({
    ...doc,
    groupId: groupId || doc.challengeId,
    filledBy: filledBy ?? "",
    filledDone: filledDone === true,
    keptAt: keptAt === undefined || keptAt === null ? 0 : keptAt.getTime(),
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
     * Stores a new open challenge.
     *
     * @param {Omit<Challenge, "state" | "endedAt" | "acceptedBy" | "acceptedName" | "roomCode" | "laterBy" | "groupId" | "filledBy" | "keptAt"> & { deleteAt: number, laterBy?: ReadonlyArray<string>, groupId?: string }} challenge
     *   `deleteAt` is when storage forgets it by itself. `laterBy` names who has it in their inbox from the start, and
     *   `groupId` is an invite's group (CC-052)
     * @returns {Promise<Readonly<Challenge>>}
     */
    add: async ({ createdAt, expiresAt, deleteAt, laterBy, ...challenge }) =>
      toChallenge(
        await challengeDao.insert({
          ...challenge,
          ...(laterBy !== undefined && laterBy.length > 0 && { laterBy: [...laterBy] }),
          state: CHALLENGE_STATES.OPEN,
          createdAt: new Date(createdAt),
          expiresAt: new Date(expiresAt),
          deleteAt: new Date(deleteAt),
        }),
      ),

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

    /**
     * Gives an invite's group to the invite `by`, while the group's first record names `from` ("" for nobody).
     *
     * @param {{ groupId: string, by: string, from: string }} group
     * @returns {Promise<boolean>}
     */
    claimGroup: (group) => challengeDao.claimGroup(group),

    /** @param {{ groupId: string, by: string }} group @returns {Promise<boolean>} */
    releaseGroup: (group) => challengeDao.releaseGroup(group),

    /** @param {{ groupId: string, by: string }} group @returns {Promise<boolean>} whether it was still `by`'s */
    confirmGroup: (group) => challengeDao.confirmGroup(group),

    /** @param {{ challengeId: string, at: number, staleBefore: number }} expiry @returns {Promise<boolean>} */
    expireNow: ({ at, staleBefore, ...expiry }) =>
      challengeDao.expireNow({ ...expiry, at: new Date(at), staleBefore: new Date(staleBefore) }),

    /** @param {{ challengeId: string, acceptedBy: string, at: number }} keep @returns {Promise<boolean>} */
    keep: ({ at, ...keep }) => challengeDao.keep({ ...keep, at: new Date(at) }),

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
