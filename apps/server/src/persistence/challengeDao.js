import mongoose from "mongoose";
import { CHALLENGE_STATES } from "@classicade/shared";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} ChallengeDoc   persistence object: one challenge (CC-139, ADR-069)
 * @property {string} challengeId   random id of the record, the id in its link, the only id a client ever sees
 * @property {string} fromId        the player who made it
 * @property {string} fromName      their display name when they made it
 * @property {boolean} fromPublic   whether that name may be shown to anyone with the link (an adult account)
 * @property {string} toId          the one player it is for, "" for a link anyone may take
 * @property {string} toName        their display name, "" for a link anyone may take
 * @property {string} gameId
 * @property {object} options       the game's options, as its engine checked them
 * @property {string} state         a CHALLENGE_STATES value, never `expired`: that comes from `expiresAt`
 * @property {Date} createdAt
 * @property {Date} expiresAt       when an open challenge stops being open
 * @property {Date} [endedAt]       when it stopped being open by someone's answer
 * @property {string} acceptedBy    the player who took it, "" until someone does
 * @property {string} acceptedName  their display name, "" until someone does
 * @property {string} roomCode      the room made for both, "" until it is made
 * @property {string[]} laterBy     the players who moved it from a popup to their inbox
 * @property {Date} deleteAt        when MongoDB deletes the record by itself
 * @property {number} [openSlot]    which of the sender's places for open challenges it holds, from 0. Unique per
 *   sender, so two challenges made at the same moment can never take one place (CC-337). It is let go only once
 *   the challenge can never be open again (`freeSlots`)
 * @property {boolean} [recentTo]  true while it is the sender's challenge to `toId` of the last ten minutes. Unique
 *   per sender and recipient, so two challenges to one person at the same moment can never both be made (CC-337)
 */

const challengeSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true },
    fromId: { type: String, required: true },
    fromName: { type: String, required: true },
    fromPublic: { type: Boolean, required: true },
    toId: { type: String, default: "" },
    toName: { type: String, default: "" },
    gameId: { type: String, required: true },
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
    state: { type: String, required: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    endedAt: { type: Date },
    acceptedBy: { type: String, default: "" },
    acceptedName: { type: String, default: "" },
    roomCode: { type: String, default: "" },
    laterBy: { type: [String], default: [] },
    deleteAt: { type: Date, required: true },
    openSlot: { type: Number },
    recentTo: { type: Boolean },
  },
  { collection: "challenges", versionKey: false, minimize: false },
);
challengeSchema.index({ challengeId: 1 }, { unique: true });
// The sender's own challenges, newest first: their inbox, the limit of open ones and the one in ten minutes rule.
challengeSchema.index({ fromId: 1, createdAt: -1 });
// One challenge per place for open challenges of each sender: the limit of open ones holds in one write (CC-337).
challengeSchema.index(
  { fromId: 1, openSlot: 1 },
  { unique: true, name: "open_slot", partialFilterExpression: { openSlot: { $exists: true } } },
);
// One recent challenge from each sender to each person: the one in ten minutes rule holds in one write (CC-337).
challengeSchema.index(
  { fromId: 1, toId: 1 },
  { unique: true, name: "recent_to", partialFilterExpression: { recentTo: { $exists: true } } },
);
// The challenges sent to one player, for their inbox.
challengeSchema.index({ toId: 1, createdAt: -1 });
// The challenges a player took, so deleting their account or moving a guest finds them.
challengeSchema.index({ acceptedBy: 1 });
// MongoDB deletes each record by itself once its time is up (ADR-069).
challengeSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

const FIELDS =
  "-_id challengeId fromId fromName fromPublic toId toName gameId options state createdAt expiresAt endedAt acceptedBy acceptedName roomCode laterBy deleteAt openSlot recentTo";
const PLAYER_FIELDS = Object.freeze(["fromId", "toId", "acceptedBy"]);
const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;
const duplicateField = ({ keyPattern }) =>
  Object.hasOwn(keyPattern, "openSlot")
    ? "openSlot"
    : Object.hasOwn(keyPattern, "toId")
      ? "recentTo"
      : "challengeId";
/** What a moved challenge gives up when its new player holds its place or mark already, in the order tried. */
const MARKS_DROPPED = Object.freeze([{}, { recentTo: 1 }, { recentTo: 1, openSlot: 1 }]);

/**
 * Challenges in MongoDB (CC-139, ADR-069). Every change of state is one conditional update, so two people taking
 * the same challenge at the same moment can never both win.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createChallengeDao({ connection }) {
  const Challenge = connection.model("Challenge", challengeSchema);
  const changed = async (filter, update) => (await Challenge.updateOne(filter, update)).modifiedCount === 1;
  // Open until `at`: open, or held by a taker whose room was never recorded and whose hold began before
  // `staleBefore`, so a crash in the middle of taking it never keeps it from everyone else.
  const stillOpen = (challengeId, at, staleBefore) => ({
    challengeId,
    expiresAt: { $gt: at },
    $or: [
      { state: CHALLENGE_STATES.OPEN },
      { state: CHALLENGE_STATES.ACCEPTED, roomCode: "", endedAt: { $lte: staleBefore } },
    ],
  });

  const dao = Object.freeze({
    ensureIndexes: () => Challenge.syncIndexes(),

    /**
     * @param {ChallengeDoc} challenge
     * @returns {Promise<ChallengeDoc>}
     * @throws {DuplicateKey} with `field` "challengeId" when a challenge with that id exists, "openSlot" when
     *   another challenge of the sender holds that place, or "recentTo" when another one to the same person does
     */
    async insert(challenge) {
      try {
        await Challenge.create(challenge);
      } catch (err) {
        if (isDuplicate(err)) {
          const field = duplicateField(err);
          throw Object.assign(new DuplicateKey(`challenge ${field} taken`, { cause: err }), { field });
        }
        throw err;
      }
      return dao.get(challenge.challengeId);
    },

    /**
     * Lets go of the places held by the sender's challenges that can never be open again at `at` or later:
     * expired, declined, withdrawn, or taken with their room made. A hold whose room is not made yet keeps its
     * place, since the challenge opens again if the room cannot be made. Lets go of the marks of its challenges to
     * one person made at `recentBefore` or earlier, too.
     *
     * @param {{ fromId: string, at: Date, recentBefore: Date }} query
     * @returns {Promise<number>} places and marks let go
     */
    async freeSlots({ fromId, at, recentBefore }) {
      const places = await Challenge.updateMany(
        {
          fromId,
          openSlot: { $exists: true },
          $or: [
            { expiresAt: { $lte: at } },
            { state: { $in: [CHALLENGE_STATES.DECLINED, CHALLENGE_STATES.WITHDRAWN] } },
            { state: CHALLENGE_STATES.ACCEPTED, roomCode: { $ne: "" } },
          ],
        },
        { $unset: { openSlot: 1 } },
      );
      const marks = await Challenge.updateMany(
        { fromId, recentTo: { $exists: true }, createdAt: { $lte: recentBefore } },
        { $unset: { recentTo: 1 } },
      );
      return places.modifiedCount + marks.modifiedCount;
    },

    /**
     * @param {string} challengeId
     * @returns {Promise<ChallengeDoc>}
     * @throws {RangeError} when there is no such challenge
     */
    async get(challengeId) {
      const doc = await Challenge.findOne({ challengeId }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`no challenge ${challengeId}`);
      }
      return doc;
    },

    /** @param {string} fromId @returns {Promise<ChallengeDoc[]>} the player's own challenges, newest first */
    listFrom: (fromId) => Challenge.find({ fromId }, FIELDS).sort({ createdAt: -1 }).lean(),

    /** @param {string} toId @returns {Promise<ChallengeDoc[]>} the challenges sent to the player, newest first */
    listTo: (toId) => Challenge.find({ toId }, FIELDS).sort({ createdAt: -1 }).lean(),

    /**
     * Takes an open challenge for `acceptedBy`, only while it is still open at `at`. A hold that began before
     * `staleBefore` with no room counts as open.
     *
     * @param {{ challengeId: string, acceptedBy: string, acceptedName: string, at: Date, staleBefore: Date }} claim
     * @returns {Promise<boolean>} whether this call took it
     */
    claim: ({ challengeId, acceptedBy, acceptedName, at, staleBefore }) =>
      changed(stillOpen(challengeId, at, staleBefore), {
        $set: { state: CHALLENGE_STATES.ACCEPTED, acceptedBy, acceptedName, endedAt: at },
      }),

    /**
     * Opens a taken challenge again when its room could not be made, only while no room is recorded for it.
     *
     * @param {{ challengeId: string, acceptedBy: string }} claim
     * @returns {Promise<boolean>} whether it was open again
     */
    release: ({ challengeId, acceptedBy }) =>
      changed(
        { challengeId, state: CHALLENGE_STATES.ACCEPTED, acceptedBy, roomCode: "" },
        { $set: { state: CHALLENGE_STATES.OPEN, acceptedBy: "", acceptedName: "" }, $unset: { endedAt: 1 } },
      ),

    /**
     * Records the room made for a challenge `acceptedBy` took.
     *
     * @param {{ challengeId: string, acceptedBy: string, roomCode: string }} room
     * @returns {Promise<boolean>}
     */
    setRoom: ({ challengeId, acceptedBy, roomCode }) =>
      changed(
        { challengeId, state: CHALLENGE_STATES.ACCEPTED, acceptedBy, roomCode: "" },
        { $set: { roomCode } },
      ),

    /**
     * Ends a challenge that is still open at `at`, as declined or withdrawn. A stale hold on it is dropped.
     *
     * @param {{ challengeId: string, state: string, at: Date, staleBefore: Date }} end
     * @returns {Promise<boolean>} whether this call ended it
     */
    end: ({ challengeId, state, at, staleBefore }) =>
      changed(stillOpen(challengeId, at, staleBefore), {
        $set: { state, endedAt: at, acceptedBy: "", acceptedName: "" },
      }),

    /**
     * Deletes one challenge, such as a new one that broke a limit.
     *
     * @param {string} challengeId
     * @returns {Promise<boolean>} whether it was there
     */
    remove: async (challengeId) => (await Challenge.deleteOne({ challengeId })).deletedCount === 1,

    /**
     * Notes that `playerId` moved the challenge to their inbox. Doing it again changes nothing.
     *
     * @param {{ challengeId: string, playerId: string }} later
     * @returns {Promise<boolean>} whether it was noted now
     */
    addLater: ({ challengeId, playerId }) => changed({ challengeId }, { $addToSet: { laterBy: playerId } }),

    /**
     * Gives every mention of player `from` to `to`, in every field that names a player. A challenge keeps its place
     * for open challenges and its mark as a recent one to its person unless `to` holds them already. Then it gives
     * up its mark first and its place next, and the checks read from the stored challenges cover it (CC-337).
     *
     * @param {{ from: string, to: string }} transfer
     * @returns {Promise<number>} records changed
     */
    async movePlayer({ from, to }) {
      const marked = await Challenge.find(
        {
          $and: [
            { $or: [{ fromId: from }, { toId: from }] },
            { $or: [{ openSlot: { $exists: true } }, { recentTo: { $exists: true } }] },
          ],
        },
        "challengeId fromId toId",
      ).lean();
      let moved = 0;
      for (const doc of marked) {
        const fields = ["fromId", "toId"].filter((field) => doc[field] === from);
        const $set = Object.fromEntries(fields.map((field) => [field, to]));
        moved += fields.length;
        for (const $unset of MARKS_DROPPED) {
          const update = Object.keys($unset).length === 0 ? { $set } : { $set, $unset };
          const done = await Challenge.updateOne({ challengeId: doc.challengeId }, update).then(
            () => true,
            (err) => {
              if (!isDuplicate(err)) throw err;
              return false;
            },
          );
          if (done) break;
        }
      }
      for (const field of PLAYER_FIELDS) {
        moved += (await Challenge.updateMany({ [field]: from }, { $set: { [field]: to } })).modifiedCount;
      }
      const later = await Challenge.updateMany({ laterBy: from }, { $set: { "laterBy.$": to } });
      return moved + later.modifiedCount;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} records deleted that the player made, was sent or took
     */
    async deleteInvolving(playerId) {
      const { deletedCount } = await Challenge.deleteMany({
        $or: PLAYER_FIELDS.map((field) => ({ [field]: playerId })),
      });
      return deletedCount;
    },
  });
  return dao;
}
