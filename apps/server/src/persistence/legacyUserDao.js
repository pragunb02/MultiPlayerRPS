/**
 * Read-only access to the legacy app's `users` collection (models/User.js in the legacy code). Used only to
 * migrate players lazily at their first login on the new stack; this DAO deliberately has no write methods,
 * so the new server can never alter legacy data.
 *
 * @typedef {{ username: string, email: string, passwordHash: string }} LegacyUserDoc
 */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The old app never had more than a handful of rows for one address. The cap only keeps a corrupt collection from
// sending back thousands.
const MAX_ROWS_PER_EMAIL = 10;
// Any character outside plain ASCII.
const NON_ASCII = "[^\\x00-\\x7F]";

/** @param {{ connection: import("mongoose").Connection }} deps */
export function createLegacyUserDao({ connection }) {
  const users = () => connection.db.collection("users");

  return Object.freeze({
    /**
     * Until CC-003 the old app stored emails exactly as typed: any case, spaces around them, and two rows for one
     * address that differ only in case. So the lookup ignores case and spaces around the stored email, and returns
     * every row it matches, so the login can pick one to check (CC-245). Rows stored in a Unicode form the one
     * spelling changes cannot be matched by a query, so the caller also passes their exact stored emails.
     *
     * @param {string} email  normalised (see `normaliseEmail`)
     * @param {string[]} [storedAs]  exact stored emails that normalise to `email`
     * @returns {Promise<LegacyUserDoc[]>} the rows with a password, oldest first, or an empty list
     */
    async listByEmail(email, storedAs = []) {
      const docs = await users()
        .find(
          {
            $or: [
              { email: { $regex: `^\\s*${escapeRegExp(email)}\\s*$`, $options: "i" } },
              { email: { $in: storedAs } },
            ],
          },
          { projection: { _id: 0, username: 1, email: 1, password: 1 } },
        )
        .sort({ _id: 1 })
        .limit(MAX_ROWS_PER_EMAIL)
        .toArray();
      return docs
        .filter((doc) => typeof doc.password === "string")
        .map((doc) => ({
          username: String(doc.username ?? ""),
          email: String(doc.email),
          passwordHash: doc.password,
        }));
    },

    /**
     * Every legacy email with a character outside plain ASCII. Only those can be stored in a spelling the one
     * email spelling changes, so this reads few rows, and only their email.
     *
     * @returns {Promise<string[]>}
     */
    async listNonAsciiEmails() {
      const docs = await users()
        .find({ email: { $regex: NON_ASCII } }, { projection: { _id: 0, email: 1 } })
        .toArray();
      return docs.map((doc) => String(doc.email));
    },
  });
}
