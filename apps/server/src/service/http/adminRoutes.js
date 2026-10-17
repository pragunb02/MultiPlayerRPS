import { Router } from "express";
import { createAnalyticsRange } from "../../models/analyticsRange.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";

const QUERY_FIELDS = Object.freeze(["from", "to", "bucket"]);
const DEFAULT_BUCKET = "day";

/**
 * Reads the range from the query. Either both days are given or neither, and then the console's default range
 * applies. Anything else in the query is refused, so a typo is never silently ignored.
 *
 * @param {import("express").Request["query"]} query
 * @param {() => Readonly<import("../../models/analyticsRange.js").AnalyticsRange>} defaultRange
 */
function parseRangeQuery(query, defaultRange) {
  const unknown = Object.keys(query).filter((key) => !QUERY_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown query parameters", { details: { fields: unknown } });
  }
  const { from, to, bucket = DEFAULT_BUCKET } = query;
  if ((from === undefined) !== (to === undefined)) {
    throw new ValidationError("Give both from and to, or neither", {
      details: { field: from ? "to" : "from" },
    });
  }
  const days = from === undefined ? defaultRange() : { from, to };
  return createAnalyticsRange({ from: days.from, to: days.to, bucket });
}

/**
 * The owner console's API (CC-233). Every route is behind `requireAdmin`, which answers 404 to anyone else.
 *
 *   GET /admin/analytics?from=2026-09-18&to=2026-10-17&bucket=day|week|month
 *     200 { report }   totals only, see domain/analytics/analyticsComponent.js. Without from and to, the last 30
 *                      India days. 400 VALIDATION_FAILED for a bad range. 404 NOT_FOUND for anyone not an admin
 *
 * @param {{
 *   analyticsComponent: ReturnType<typeof import("../../domain/analytics/analyticsComponent.js").createAnalyticsComponent>,
 *   requireAdmin: import("express").RequestHandler,
 *   now: () => number,
 * }} deps
 */
export function createAdminRoutes({ analyticsComponent, requireAdmin, now }) {
  assertDefined(analyticsComponent, "analyticsComponent");
  assertFunction(requireAdmin, "requireAdmin");
  assertFunction(now, "now");
  const router = Router();

  router.use("/admin", requireAdmin);

  router.get("/admin/analytics", async (req, res) => {
    const at = now();
    const range = parseRangeQuery(req.query, () => analyticsComponent.defaultRange({ now: at }));
    const report = await analyticsComponent.getReport({ range, now: at });
    res.json({ report });
  });

  return router;
}
