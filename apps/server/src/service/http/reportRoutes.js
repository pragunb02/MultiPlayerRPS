import { Router } from "express";
import { REPORT_ACTIONS, REPORT_NOTE_MAX, REPORT_REASONS, REPORT_STATUS, REPORT_STATUSES } from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { isPlainObject, parseReference, REFERENCE_KIND, UUID_PATTERN } from "./playerReferenceInput.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// The console reads at most this many reports of one status, newest first. Far more than one owner reads.
const QUEUE_LIMIT = 500;

/**
 * The limits on reporting (ADR-071.5, in the style of ADR-035). Each is a business rule, and tests and browser tests
 * may change them. One report per reporter and player a day is the store's own rule.
 *
 * 1. `perPlayer`: reports per player in a day. More than anyone meets bad players, too few to flood the queue.
 * 2. `perAddress`: reports per network address in a day, so new guests buy no more. It counts only what the player's
 *    own limit let through, so one player cannot use up a school's address.
 */
export const REPORT_LIMITS = Object.freeze({
  perPlayer: Object.freeze({ windowMs: DAY_MS, limit: 10 }),
  perAddress: Object.freeze({ windowMs: DAY_MS, limit: 30 }),
});

const invalid = (field, message) => new ValidationError(message, { details: { field } });

// Control characters other than a new line or a tab. Nobody means to type them (as feedback, ADR-059).
const CONTROL = /[^\P{Cc}\n\t]/gu;

/** The optional note as plain text: one kind of new line, no control characters, the ends trimmed. */
function parseNote(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > REPORT_NOTE_MAX) {
    throw invalid("note", `Write a note of at most ${REPORT_NOTE_MAX} characters, or none`);
  }
  const note = value.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
  return note === "" ? undefined : note;
}

function parseReason(value) {
  if (!REPORT_REASONS.includes(value)) {
    throw invalid("reason", `reason must be one of ${REPORT_REASONS.join(", ")}`);
  }
  return value;
}

/**
 * A report: who, by where the two met (never a player id), a closed reason and an optional note. Nothing else.
 *
 * @returns {{ target: import("../../domain/reports/reportComponent.js").ReportTarget, reason: string, note?: string }}
 */
function parseReport(body) {
  const target = parseReference(body, {
    kinds: [REFERENCE_KIND.ROOM, REFERENCE_KIND.MATCH, REFERENCE_KIND.HANDLE],
    extra: ["reason", "note"],
    message: "Send who you report (a room seat, a match seat or a profile), a reason and a note",
  });
  const fields = Object.fromEntries(Object.entries(target).filter(([key]) => key !== "reason" && key !== "note"));
  const note = parseNote(body.note);
  return {
    target: /** @type {import("../../domain/reports/reportComponent.js").ReportTarget} */ (fields),
    reason: parseReason(body.reason),
    ...(note !== undefined && { note }),
  };
}

/** The queue's one filter. Anything else in the query is refused, so a typo is never silently ignored. */
function parseQueueQuery(query) {
  const unknown = Object.keys(query).filter((key) => key !== "status");
  if (unknown.length > 0) {
    throw new ValidationError("Unknown query parameters", { details: { fields: unknown } });
  }
  const { status = REPORT_STATUS.OPEN } = query;
  if (!REPORT_STATUSES.includes(status)) {
    throw invalid("status", `status must be one of ${REPORT_STATUSES.join(", ")}`);
  }
  return { status };
}

function parseAction(params, body) {
  if (!UUID_PATTERN.test(params.reportId)) throw invalid("reportId", "Invalid report id");
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "action")) {
    throw new ValidationError("Send only the action", { details: { fields: ["action"] } });
  }
  if (!REPORT_ACTIONS.includes(body.action)) {
    throw invalid("action", `action must be one of ${REPORT_ACTIONS.join(", ")}`);
  }
  return { reportId: params.reportId, action: body.action };
}

/**
 * Reports (CC-044, ADR-071).
 *
 * 1. `POST /reports` with `{ roomCode, seat, seatId }`, `{ matchId, seat }` or `{ handle }`, a `reason` and an
 *    optional `note`, from a guest or an account, answers `{ report: { reportId, createdAt } }`, the same for a repeat
 *    the same day. 404 for anyone the server cannot confirm, 400 for anything else in the body, 429 over a limit,
 *    401 for a visitor. Nothing is sent to the reported player.
 * 2. `GET /admin/reports?status=open|dismissed|actioned` answers an admin `{ groups }`, the reports grouped by
 *    reported player, without any player id.
 * 3. `POST /admin/reports/:reportId/actions` with `{ action: "dismiss" | "rename" }` acts on the player of that
 *    report and answers an admin `{ result: { closed, displayName? } }`. 409 when the reports are closed already or a
 *    guest would be renamed. Everyone else gets the console's 404 on both (ADR-036).
 *
 * @param {{
 *   reportComponent: Pick<ReturnType<typeof import("../../domain/reports/reportComponent.js").createReportComponent>, "report" | "queue" | "act">,
 *   requireAdmin: import("express").RequestHandler,
 *   now?: () => number,
 *   limits?: Partial<typeof REPORT_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createReportRoutes({ reportComponent, requireAdmin, now = Date.now, limits = {} }) {
  assertDefined(reportComponent, "reportComponent");
  assertFunction(requireAdmin, "requireAdmin");
  const rules = { ...REPORT_LIMITS, ...limits };
  const router = Router();

  // Signed in first, so a visitor is told 401 and is never counted.
  const signedIn = (req, res, next) => {
    requireIdentity(req.session);
    next();
  };
  const perPlayer = createRateLimit({
    ...rules.perPlayer,
    message: "You have sent a lot of reports today. Thank you, try again tomorrow",
    keyGenerator: (req) => `player:${requireIdentity(req.session).id}`,
  });
  const perAddress = createRateLimit({
    ...rules.perAddress,
    message: "A lot of reports came from your network today, try again tomorrow",
    headers: false,
  });

  // The player's own limit first, so the network's budget counts only what it let through.
  router.post("/reports", signedIn, perPlayer, perAddress, async (req, res) => {
    const { target, reason, note } = parseReport(req.body);
    const reporter = requireIdentity(req.session);
    const report = await reportComponent.report({
      reporter,
      target,
      reason,
      ...(note !== undefined && { note }),
      now: now(),
    });
    // Nobody is named in the log, neither who reported nor who was reported, and never the note.
    req.log.info({ reportReason: reason }, "player reported");
    res.set("Cache-Control", "no-store");
    res.json({ report });
  });

  router.get("/admin/reports", requireAdmin, async (req, res) => {
    const { status } = parseQueueQuery(req.query);
    const { groups } = await reportComponent.queue({ status, limit: QUEUE_LIMIT });
    res.json({ groups });
  });

  router.post("/admin/reports/:reportId/actions", requireAdmin, async (req, res) => {
    const { reportId, action } = parseAction(req.params, req.body);
    const result = await reportComponent.act({ reportId, action, now: now() });
    // The admin and the report are named, so every action can be traced (ADR-071.6). The reported player is not.
    req.log.info({ adminId: requireIdentity(req.session).id, reportId, action }, "reports acted on");
    res.json({ result });
  });

  return router;
}
