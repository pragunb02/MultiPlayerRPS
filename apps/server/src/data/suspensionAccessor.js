import { SUSPENSION_KEEP_DAYS } from "@classicade/shared";
import { assertDefined } from "../utils/assert.js";
import { DuplicateKey } from "../persistence/errors.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

const KEEP_MS = SUSPENSION_KEEP_DAYS * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} Suspension     domain model (frozen, times in ms): the owner suspended one account (CC-334)
 * @property {string} suspensionId
 * @property {string} playerId       server only, never sent to a client
 * @property {string} nameThen
 * @property {string} duration       one of SUSPENSION_DURATIONS
 * @property {string} reason         one of SUSPENSION_REASONS
 * @property {number} startedAt
 * @property {number} [endsAt]       left out while it lasts until lifted
 * @property {string} byId           server only
 * @property {string} byName
 * @property {number} [liftedAt]
 * @property {string} [liftedById]   server only
 * @property {string} [liftedByName]
 *
 * @typedef {Readonly<{ id: string, name: string }>} Actor   the admin who acted, by account id and name then
 */

/** @returns {Readonly<Suspension>} */
const toSuspension = ({ startedAt, endsAt, liftedAt, deleteAt, activeFor, ...doc }) =>
  Object.freeze({
    ...doc,
    startedAt: startedAt.getTime(),
    ...(endsAt !== null && endsAt !== undefined && { endsAt: endsAt.getTime() }),
    ...(liftedAt !== undefined && { liftedAt: liftedAt.getTime() }),
  });
const toList = (docs) => Object.freeze(docs.map(toSuspension));

/**
 * Provides account suspensions to the domain (CC-334, ADR-078). It also decides how long each record is kept:
 * SUSPENSION_KEEP_DAYS after its end, or after its lift; while one until lifted lasts, it has no end to count from.
 *
 * @param {{ suspensionDao: ReturnType<typeof import("../persistence/suspensionDao.js").createSuspensionDao> }} deps
 */
export function createSuspensionAccessor({ suspensionDao }) {
  assertDefined(suspensionDao, "suspensionDao");

  return Object.freeze({
    /**
     * @param {Omit<Suspension, "byId" | "byName" | "liftedAt" | "liftedById" | "liftedByName"> & { by: Actor }} input
     *   leave `endsAt` out for a suspension until lifted
     * @returns {Promise<Readonly<Suspension>>}
     * @throws {ConflictError} when the player has a suspension in effect already, also one stored a moment before:
     *   the store holds one mark per player (review of CC-334)
     */
    async add({ by, startedAt, endsAt, ...fields }) {
      // A suspension of the player that has ended by now no longer holds the player's one mark.
      await suspensionDao.releaseEnded({ playerId: fields.playerId, at: new Date(startedAt) });
      try {
        return toSuspension(
          await suspensionDao.insert({
            ...fields,
            startedAt: new Date(startedAt),
            endsAt: endsAt === undefined ? null : new Date(endsAt),
            byId: by.id,
            byName: by.name,
            activeFor: fields.playerId,
            ...(endsAt !== undefined && { deleteAt: new Date(endsAt + KEEP_MS) }),
          }),
        );
      } catch (err) {
        if (err instanceof DuplicateKey) {
          throw new ConflictError("This account is suspended already. Lift it first", { cause: err });
        }
        throw err;
      }
    },

    /**
     * @param {string} suspensionId
     * @returns {Promise<Readonly<Suspension>>}
     * @throws {NotFoundError} when there is no such suspension
     */
    async get(suspensionId) {
      try {
        return toSuspension(await suspensionDao.getById(suspensionId));
      } catch (err) {
        if (err instanceof RangeError) throw new NotFoundError("No such suspension", { cause: err });
        throw err;
      }
    },

    /** @param {string} playerId @returns {Promise<ReadonlyArray<Readonly<Suspension>>>} newest first */
    listByPlayer: async (playerId) => toList(await suspensionDao.listByPlayer(playerId)),

    /** @param {{ at: number }} query @returns {Promise<ReadonlyArray<Readonly<Suspension>>>} in effect, newest first */
    listActive: async ({ at }) => toList(await suspensionDao.listActive({ at: new Date(at) })),

    /**
     * The players suspended at a moment, for the boards to hide (ADR-078).
     *
     * @param {{ at: number }} query
     * @returns {Promise<ReadonlySet<string>>}
     */
    activePlayerIds: async ({ at }) =>
      new Set((await suspensionDao.listActive({ at: new Date(at) })).map((doc) => doc.playerId)),

    /**
     * Lifts a suspension still in effect, and keeps its record SUSPENSION_KEEP_DAYS from now.
     *
     * @param {{ suspensionId: string, by: Actor, at: number }} lift
     * @returns {Promise<boolean>} false when it had ended, was lifted already, or does not exist
     */
    lift: ({ suspensionId, by, at }) =>
      suspensionDao.lift({
        suspensionId,
        liftedAt: new Date(at),
        liftedById: by.id,
        liftedByName: by.name,
        deleteAt: new Date(at + KEEP_MS),
      }),

    /** @param {string} playerId @returns {Promise<number>} records removed (account deletion, ADR-048.2) */
    removePlayer: (playerId) => suspensionDao.deleteByPlayer(playerId),
  });
}
