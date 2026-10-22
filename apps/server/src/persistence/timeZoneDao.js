import mongoose from "mongoose";

const DUPLICATE_KEY_CODE = 11000;
const FIELDS = "-_id playerId zone previousZone changedAt effectiveAt floorDay";

/**
 * @typedef {Object} TimeZoneDoc   persistence object: one player's time zone (CC-146, ADR-077)
 * @property {string} playerId
 * @property {string} zone          IANA name in use, canonical
 * @property {string} previousZone  the zone before the last change
 * @property {Date} changedAt       when the player last changed it
 * @property {Date} effectiveAt     when `zone` took over
 * @property {string} floorDay      YYYY-MM-DD: the zone never gives a day before it
 */

const timeZoneSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    zone: { type: String, required: true },
    previousZone: { type: String, required: true },
    changedAt: { type: Date, required: true },
    effectiveAt: { type: Date, required: true },
    floorDay: { type: String, required: true },
  },
  { collection: "player_time_zones", versionKey: false },
);
timeZoneSchema.index({ playerId: 1 }, { unique: true });

/**
 * Players' time zones in MongoDB (CC-146). A collection of its own, which nothing else reads or writes. Writes are
 * compare-and-set on `changedAt`, so two tabs changing the zone at once cannot both pass the 7 day lock.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createTimeZoneDao({ connection }) {
  const TimeZone = connection.model("PlayerTimeZone", timeZoneSchema);

  return Object.freeze({
    ensureIndexes: () => TimeZone.syncIndexes(),

    /**
     * @param {string} playerId
     * @returns {Promise<TimeZoneDoc[]>} none or one
     */
    async findByPlayer(playerId) {
      const doc = await TimeZone.findOne({ playerId }, FIELDS).lean();
      return doc === null ? [] : [doc];
    },

    /**
     * Saves a player's zone if the stored one is still the one read: `expectedChangedAt` is its `changedAt`, or
     * `null` when there was none.
     *
     * @param {{ doc: TimeZoneDoc, expectedChangedAt: Date | null }} write
     * @returns {Promise<boolean>} false when another write got in first
     */
    async save({ doc, expectedChangedAt }) {
      if (expectedChangedAt === null) {
        try {
          await TimeZone.create(doc);
          return true;
        } catch (err) {
          if (err.code === DUPLICATE_KEY_CODE) {
            return false;
          }
          throw err;
        }
      }
      const { matchedCount } = await TimeZone.replaceOne(
        { playerId: doc.playerId, changedAt: expectedChangedAt },
        doc,
      );
      return matchedCount === 1;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} documents removed (0 or 1)
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await TimeZone.deleteOne({ playerId });
      return deletedCount;
    },
  });
}
