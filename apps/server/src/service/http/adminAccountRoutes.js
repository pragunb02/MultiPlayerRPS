import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { requireIdentity } from "./session.js";

const FIELDS = Object.freeze(["email", "birthYear"]);

/** Exactly `email` and `birthYear`, both given (`birthYear` may be null). Content rules live in the domain. */
function correctionOf(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const unknown = Object.keys(body).filter((key) => !FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown fields in payload", { details: { fields: unknown } });
  }
  const missing = FIELDS.filter((key) => !Object.hasOwn(body, key));
  if (missing.length > 0) {
    throw new ValidationError("Give the email and the year, or null to clear it", {
      details: { fields: missing },
    });
  }
  return body;
}

/**
 * The owner's corrections of a birth year (CC-152, ADR-048.9). A player cannot change a year once set, so a minor
 * cannot unlock the adult defaults with one click. The owner checks a request first (for example a message from the
 * account's own email address), then sends it here. Behind `requireAdmin`, which answers 404 to anyone else.
 *
 *   PUT /admin/accounts/birth-year { email, birthYear }  `birthYear` a year from the picker, or null to clear it
 *     200 { account: { username, birthYear?, ageGroup } }. 400 VALIDATION_FAILED for a bad body, an under 13 year
 *     (`reason: "too-young"`, delete that account instead). 404 for an email with no account, or anyone not an admin
 *
 * The log line names the account and the admin, never the year or the email.
 *
 * @param {{
 *   accountComponent: Pick<ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>, "correctBirthYear">,
 *   requireAdmin: import("express").RequestHandler,
 *   now: () => number,
 * }} deps
 */
export function createAdminAccountRoutes({ accountComponent, requireAdmin, now }) {
  assertDefined(accountComponent, "accountComponent");
  assertFunction(requireAdmin, "requireAdmin");
  assertFunction(now, "now");
  const router = Router();

  router.put("/admin/accounts/birth-year", requireAdmin, async (req, res) => {
    const { email, birthYear } = correctionOf(req.body);
    const { playerId, ...account } = await accountComponent.correctBirthYear({
      email,
      birthYear,
      now: now(),
    });
    req.log.info({ playerId, adminId: requireIdentity(req.session).id }, "birth year corrected by the owner");
    res.json({ account });
  });

  return router;
}
