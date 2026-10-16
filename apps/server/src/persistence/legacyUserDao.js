/**
 * Read-only access to the legacy app's `users` collection (models/User.js in the legacy code). Used only to
 * migrate players lazily at their first login on the new stack; this DAO deliberately has no write methods,
 * so the new server can never alter legacy data.
 *
 * @typedef {{ username: string, email: string, passwordHash: string }} LegacyUserDoc
 */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {{ connection: import("mongoose").Connection }} deps */
export function createLegacyUserDao({ connection }) {
  const users = () => connection.db.collection("users");

  return Object.freeze({
    /**
     * Legacy signups stored emails as typed, so the lookup ignores case.
     *
     * @param {string} email  normalised (lower-case)
     * @returns {Promise<LegacyUserDoc>}
     * @throws {RangeError} when no legacy user has this email
     */
    async getByEmail(email) {
      const doc = await users().findOne(
        { email: { $regex: `^${escapeRegExp(email)}$`, $options: "i" } },
        { projection: { _id: 0, username: 1, email: 1, password: 1 } },
      );
      if (doc === null || typeof doc.password !== "string") {
        throw new RangeError("No legacy user for that email");
      }
      return { username: String(doc.username ?? ""), email: String(doc.email), passwordHash: doc.password };
    },
  });
}
