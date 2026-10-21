import { Router } from "express";
import { ANALYTICS_MAX_RANGE_DAYS } from "@classicade/shared";
import { UX_SECTIONS, UX_WEEK_SECTIONS } from "../../domain/telemetry/uxReport.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { dayOf, daysBetween, isDay } from "../../utils/indiaTime.js";
import { requireIdentity } from "./session.js";

const QUERY_FIELDS = Object.freeze(["section", "from", "to"]);

/** The range in the query, or the section's default: whole India days only, ending before today. */
function rangeOf(query, today, fallback) {
  const { from, to } = query;
  if ((from === undefined) !== (to === undefined)) {
    throw new ValidationError("Give both from and to, or neither", {
      details: { field: from ? "to" : "from" },
    });
  }
  if (from === undefined) return fallback();
  if (!isDay(from) || !isDay(to)) {
    throw new ValidationError("from and to must be days, YYYY-MM-DD", {
      details: { field: isDay(from) ? "to" : "from" },
    });
  }
  if (to < from) throw new ValidationError("to must not be before from", { details: { field: "to" } });
  // Today is not over, and its totals are worked out after midnight: a range of whole days only (CC-177).
  if (to >= today)
    throw new ValidationError("A range ends yesterday at the latest", { details: { field: "to" } });
  if (daysBetween(from, to) + 1 > ANALYTICS_MAX_RANGE_DAYS) {
    throw new ValidationError(`A range can cover at most ${ANALYTICS_MAX_RANGE_DAYS} days`, {
      details: { field: "from" },
    });
  }
  return { from, to };
}

/**
 * The owner's UX page (CC-177) and weekly report (CC-313), behind the console's allowlist (ADR-036).
 *
 *   GET /admin/ux?section=funnels|clicks|errors|speed|latency|interruptions|week|badge&from=YYYY-MM-DD&to=YYYY-MM-DD
 *     200 { report }   anonymous totals with "<5" applied (domain/telemetry/uxReport.js). Without from and to, the
 *                      last 7 full India days (the last full Monday to Sunday week for week and badge). 400
 *                      VALIDATION_FAILED for a bad query. 404 NOT_FOUND for anyone not an admin, and for an admin
 *                      while the section's flag (`console_ux`, or `console_ux_week` for week and badge) is off
 *
 * Nothing about who asked is passed on or logged.
 *
 * @param {{
 *   uxReport: ReturnType<typeof import("../../domain/telemetry/uxReport.js").createUxReport>,
 *   adminAccess: ReturnType<typeof import("./adminAccess.js").createAdminAccess>,
 *   flagComponent: { isOn: (name: string, player: object | undefined) => Promise<boolean> },
 *   now: () => number,
 * }} deps
 */
export function createAdminUxRoutes({ uxReport, adminAccess, flagComponent, now }) {
  assertDefined(uxReport, "uxReport");
  assertFunction(adminAccess?.requireAdmin, "adminAccess.requireAdmin");
  assertFunction(flagComponent?.isOn, "flagComponent.isOn");
  assertFunction(now, "now");
  const router = Router();

  router.get("/admin/ux", adminAccess.requireAdmin, async (req, res) => {
    const unknown = Object.keys(req.query).filter((key) => !QUERY_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new ValidationError("Unknown query parameters", { details: { fields: unknown } });
    }
    const { section } = req.query;
    if (!UX_SECTIONS.includes(section)) {
      throw new ValidationError("Unknown section", { details: { field: "section" } });
    }
    const week = UX_WEEK_SECTIONS.includes(section);
    const { id, kind } = requireIdentity(req.session);
    const on = week
      ? await flagComponent.isOn("console_ux_week", { id, kind, admin: true })
      : await flagComponent.isOn("console_ux", { id, kind, admin: true });
    // The same 404 as an unknown address while the flag is off, so a half-built page never shows.
    if (!on) throw new NotFoundError("Not found");
    const range = rangeOf(req.query, dayOf(now()), week ? uxReport.lastFullWeek : uxReport.defaultRange);
    res.json({ report: await uxReport.get({ section, range }) });
  });

  return router;
}
