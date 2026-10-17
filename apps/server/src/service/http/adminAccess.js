import { isAccountId } from "../../models/identity.js";
import { NotFoundError } from "../../utils/errors.js";
import { requireIdentity } from "./session.js";

/**
 * Who may open the owner console (CC-233): only the accounts listed in ADMIN_ACCOUNT_IDS, checked on the server
 * for every request. Everyone else, guests and visitors included, gets the same 404 as any unknown address, so
 * the console's existence is not revealed. Admin answers are never cached and ask search engines not to list them.
 *
 * @param {{ adminAccountIds: ReadonlyArray<string> }} options
 */
export function createAdminAccess({ adminAccountIds }) {
  const admins = new Set(adminAccountIds);

  /**
   * Whether a session belongs to an admin. A session with a broken identity is not one.
   *
   * @param {Partial<import("express-session").SessionData> | undefined} sessionData
   * @returns {boolean}
   */
  function isAdmin(sessionData) {
    if (admins.size === 0 || sessionData?.identity === undefined) {
      return false;
    }
    try {
      const { id } = requireIdentity(sessionData);
      return isAccountId(id) && admins.has(id);
    } catch {
      return false;
    }
  }

  /** @type {import("express").RequestHandler} */
  function requireAdmin(req, res, next) {
    if (!isAdmin(req.session)) {
      next(new NotFoundError("Not found"));
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  }

  return Object.freeze({ isAdmin, requireAdmin });
}
