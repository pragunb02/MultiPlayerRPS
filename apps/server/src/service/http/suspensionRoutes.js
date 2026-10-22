import { Router } from "express";
import { SUSPENSION_DURATIONS, SUSPENSION_REASONS } from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { isPlainObject, UUID_PATTERN } from "./playerReferenceInput.js";
import { requireIdentity } from "./session.js";

const invalid = (field, message) => new ValidationError(message, { details: { field } });

/** A UUID route parameter, or a 400 that names it. */
function idParam(value, field) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid(field, `Invalid ${field}`);
  return value;
}

/** Exactly a duration and a reason, both from their closed lists. No free text, nothing else (ADR-078). */
function parseSuspension(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "duration" && key !== "reason")) {
    throw new ValidationError("Send only a duration and a reason", {
      details: { fields: ["duration", "reason"] },
    });
  }
  if (!SUSPENSION_DURATIONS.includes(body.duration)) {
    throw invalid("duration", `duration must be one of ${SUSPENSION_DURATIONS.join(", ")}`);
  }
  if (!SUSPENSION_REASONS.includes(body.reason)) {
    throw invalid("reason", `reason must be one of ${SUSPENSION_REASONS.join(", ")}`);
  }
  return { duration: body.duration, reason: body.reason };
}

/** No body at all, or an empty object. */
function requireNoBody(body) {
  if (body !== undefined && (!isPlainObject(body) || Object.keys(body).length > 0)) {
    throw new ValidationError("Send no body");
  }
}

/** The admin who acts, by account id (kept on the server) and name (shown in the console). */
const actorOf = (req) => {
  const { id, displayName } = requireIdentity(req.session);
  return Object.freeze({ id, name: displayName });
};

/**
 * Account suspensions in the owner console (CC-334, ADR-078). Everyone but an admin gets the console's 404 on every
 * route (ADR-036.1), and no answer holds a player id: the account is named by a report's id or the suspension's.
 *
 * 1. `POST /admin/reports/:reportId/suspension` with `{ duration, reason }` suspends the account the report is about
 *    and answers `{ suspension, closed }`. 409 for a guest, an admin account or an account suspended already.
 * 2. `GET /admin/reports/:reportId/suspensions` answers `{ suspensions }`, that account's history, newest first.
 * 3. `GET /admin/suspensions` answers `{ suspensions }`, the ones in effect now.
 * 4. `POST /admin/suspensions/:suspensionId/lift` with no body lifts one and answers `{ suspension }`. 409 once it
 *    has ended.
 *
 * @param {{
 *   reportComponent: Pick<ReturnType<typeof import("../../domain/reports/reportComponent.js").createReportComponent>, "suspend" | "suspensionsOf">,
 *   suspensionComponent: Pick<ReturnType<typeof import("../../domain/suspensions/suspensionComponent.js").createSuspensionComponent>, "current" | "lift">,
 *   requireAdmin: import("express").RequestHandler,
 *   now?: () => number,
 * }} deps
 */
export function createSuspensionRoutes({
  reportComponent,
  suspensionComponent,
  requireAdmin,
  now = Date.now,
}) {
  assertDefined(reportComponent, "reportComponent");
  assertDefined(suspensionComponent, "suspensionComponent");
  assertFunction(requireAdmin, "requireAdmin");
  const router = Router();

  router.post("/admin/reports/:reportId/suspension", requireAdmin, async (req, res) => {
    const reportId = idParam(req.params.reportId, "reportId");
    const { duration, reason } = parseSuspension(req.body);
    const by = actorOf(req);
    const { suspension, failed, closed } = await reportComponent.suspend({
      reportId,
      duration,
      reason,
      by,
      now: now(),
    });
    // Who acted, on what, for how long and why, so every suspension can be traced. Never the player or a reporter.
    req.log.info(
      { adminId: by.id, reportId, suspensionId: suspension.suspensionId, duration, reason },
      "account suspended",
    );
    for (const { name, err } of failed) {
      req.log.error(
        { err, suspensionId: suspension.suspensionId, follower: name },
        "a suspension follower failed",
      );
    }
    res.json({ suspension, closed });
  });

  router.get("/admin/reports/:reportId/suspensions", requireAdmin, async (req, res) => {
    const reportId = idParam(req.params.reportId, "reportId");
    res.json({ suspensions: await reportComponent.suspensionsOf({ reportId, now: now() }) });
  });

  router.get("/admin/suspensions", requireAdmin, async (req, res) => {
    if (Object.keys(req.query).length > 0) {
      throw new ValidationError("Unknown query parameters", { details: { fields: Object.keys(req.query) } });
    }
    res.json({ suspensions: await suspensionComponent.current({ now: now() }) });
  });

  router.post("/admin/suspensions/:suspensionId/lift", requireAdmin, async (req, res) => {
    const suspensionId = idParam(req.params.suspensionId, "suspensionId");
    requireNoBody(req.body);
    const by = actorOf(req);
    const suspension = await suspensionComponent.lift({ suspensionId, by, now: now() });
    req.log.info({ adminId: by.id, suspensionId }, "suspension lifted");
    res.json({ suspension });
  });

  return router;
}
