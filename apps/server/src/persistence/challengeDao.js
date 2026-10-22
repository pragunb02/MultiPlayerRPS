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
 * @property {string} [groupId]     an invite to a friend (CC-052): the first of its sender's open invites to the same
 *   game when it was made, whose record decides who plays. Missing on a link, or on a record made before CC-052
 * @property {string} [filledBy]    on the first of a group: the invite whose friend plays, missing or "" while nobody
 * @property {boolean} [filledDone] on the first of a group: that invite's room is made, so nobody can take it over
 * @property {Date} [keptAt]        when the friend who took it kept it for later, so its room stops waiting
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
    groupId: { type: String },
    filledBy: { type: String },
    filledDone: { type: Boolean },
    keptAt: { type: Date },
  },
  { collection: "challenges", versionKey: false, minimize: false },
);
challengeSchema.index({ challengeId: 1 }, { unique: true });
// The sender's own challenges, newest first: their inbox, the limit of open ones and the one in ten minutes rule.
challengeSchema.index({ fromId: 1, createdAt: -1 });
// The challenges sent to one player, for their inbox.
challengeSchema.index({ toId: 1, createdAt: -1 });
// The challenges a player took, so deleting their account or moving a guest finds them.
challengeSchema.index({ acceptedBy: 1 });
// MongoDB deletes each record by itself once its time is up (ADR-069).
challengeSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

const FIELDS =
  "-_id challengeId fromId fromName fromPublic toId toName gameId options state createdAt expiresAt endedAt acceptedBy acceptedName roomCode laterBy deleteAt groupId filledBy filledDone keptAt";
const PLAYER_FIELDS = Object.freeze(["fromId", "toId", "acceptedBy"]);
const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;

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
     * @throws {DuplicateKey} when a challenge with that id exists
     */
    async insert(challenge) {
      try {
        await Challenge.create(challenge);
      } catch (err) {
        if (isDuplicate(err)) {
          throw new DuplicateKey(`challenge ${challenge.challengeId} exists`, { cause: err });
        }
        throw err;
      }
      return dao.get(challenge.challengeId);
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
     * Gives a group of invites to the invite `by`, only while the group's first record names `from` as its player:
     * nobody ("" or never written), or a holder that lost its claim and whose room was never made. So of two friends
     * accepting at once, one wins.
     *
     * @param {{ groupId: string, by: string, from: string }} group
     * @returns {Promise<boolean>} whether this call gave it
     */
    claimGroup: ({ groupId, by, from }) =>
      changed(
        {
          challengeId: groupId,
          filledBy: from === "" ? { $in: ["", null] } : from,
          filledDone: { $ne: true },
        },
        { $set: { filledBy: by } },
      ),

    /**
     * Notes that the room of the invite `by` is made, only while the group still names it. From then on nobody can
     * take the group over.
     *
     * @param {{ groupId: string, by: string }} group
     * @returns {Promise<boolean>} whether the group was still this invite's
     */
    confirmGroup: ({ groupId, by }) =>
      changed(
        { challengeId: groupId, filledBy: by, filledDone: { $ne: true } },
        { $set: { filledDone: true } },
      ),

    /**
     * Frees a group again, when the room of the invite `by` could not be made.
     *
     * @param {{ groupId: string, by: string }} group
     * @returns {Promise<boolean>}
     */
    releaseGroup: ({ groupId, by }) =>
      changed({ challengeId: groupId, filledBy: by, filledDone: { $ne: true } }, { $set: { filledBy: "" } }),

    /**
     * Ends an open challenge now, as if its day were over: the friendship it was made for ended (CC-052). It then
     * reads as expired to everyone, exactly as one nobody answered.
     *
     * @param {{ challengeId: string, at: Date, staleBefore: Date }} expiry
     * @returns {Promise<boolean>} whether this call ended it
     */
    expireNow: ({ challengeId, at, staleBefore }) =>
      changed(stillOpen(challengeId, at, staleBefore), {
        $set: { state: CHALLENGE_STATES.OPEN, expiresAt: at, acceptedBy: "", acceptedName: "" },
        $unset: { endedAt: 1 },
      }),

    /**
     * Notes that the friend who took an invite kept it for later, once, while its room is recorded.
     *
     * @param {{ challengeId: string, acceptedBy: string, at: Date }} keep
     * @returns {Promise<boolean>} whether this call noted it
     */
    keep: ({ challengeId, acceptedBy, at }) =>
      changed(
        {
          challengeId,
          state: CHALLENGE_STATES.ACCEPTED,
          acceptedBy,
          roomCode: { $ne: "" },
          keptAt: { $exists: false },
        },
        { $set: { keptAt: at } },
      ),

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
     * Gives every mention of player `from` to `to`, in every field that names a player.
     *
     * @param {{ from: string, to: string }} transfer
     * @returns {Promise<number>} records changed
     */
    async movePlayer({ from, to }) {
      let moved = 0;
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
