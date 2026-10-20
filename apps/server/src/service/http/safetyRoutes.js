import { Router } from "express";
import { clientPolicyOf } from "../../domain/safety/agePolicy.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { requireIdentity } from "./session.js";

/**
 * The player's own age policy flags, for the features that run in the browser, such as the result share (CC-152).
 *
 *   GET /safety  200 { safety: { canFollow, friendsMode, emotes, quietHours, shareCardName, maxOwnedCircleSize,
 *                publicProfile, boardName } }. Never the age group or a birth year, and never cached. A visitor with
 *                no session gets the safest flags, the same as an account of unknown age (ADR-028.1)
 *
 * @param {{
 *   safetyComponent: Pick<ReturnType<typeof import("../../domain/safety/safetyComponent.js").createSafetyComponent>, "policyFor">,
 *   now: () => number,
 * }} deps
 */
export function createSafetyRoutes({ safetyComponent, now }) {
  assertDefined(safetyComponent, "safetyComponent");
  assertFunction(now, "now");
  const router = Router();

  router.get("/safety", async (req, res) => {
    const playerId = req.session.identity === undefined ? "" : requireIdentity(req.session).id;
    const policy = await safetyComponent.policyFor({ playerId, now: now() });
    res.setHeader("Cache-Control", "no-store");
    res.json({ safety: clientPolicyOf(policy) });
  });

  return router;
}
