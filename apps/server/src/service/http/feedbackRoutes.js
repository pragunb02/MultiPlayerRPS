import { Router } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import {
  FEEDBACK_DEVICES,
  FEEDBACK_KEEP_DAYS,
  FEEDBACK_KIND,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  IDENTITY_KINDS,
  isFeedbackPage,
} from "@classicade/shared";
import { parseEmail } from "../../models/credentials.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How much of the database feedback may fill at most, and the most one item can take: a message of 1000 characters
 * of three bytes each, the longest email, page and build, and the other fields. The free database tier has 512 MB.
 */
export const FEEDBACK_STORAGE_BUDGET_BYTES = 200 * 1024 * 1024;
export const FEEDBACK_ITEM_MAX_BYTES = 4096;

// Items kept at once are at most the daily cap times the days each is kept, so this cap keeps them inside the budget.
const SITE_DAILY_LIMIT = Math.floor(
  FEEDBACK_STORAGE_BUDGET_BYTES / (FEEDBACK_KEEP_DAYS * FEEDBACK_ITEM_MAX_BYTES),
);

// The daily share counts a whole IPv6 /48, the block a home or an office is usually given, so one network cannot
// take more shares by moving through its addresses.
const DAILY_IPV6_BLOCK = 48;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The inbox shows this many at a time.
const PAGE_SIZE = 50;

/**
 * The limits on sending feedback (ADR-059, in the style of ADR-035). Each is a business rule, and tests and browser
 * tests may change them.
 *
 * 1. `perSession`: items per guest or account session in an hour. More than anyone writes, too few to flood with.
 * 2. `perAddress`: items per network address in an hour, so new guests or no session at all buy no more.
 * 3. `perAddressDaily`: items per network in a day, an IPv6 /48 counted as one. A tenth of the site's cap at most, so
 *    one network alone can never use up the day for everyone.
 * 4. `site`: items stored for the whole site in a day, worked out from the storage budget, so many networks together
 *    cannot fill the database. Only stored items count here.
 */
export const FEEDBACK_LIMITS = Object.freeze({
  perSession: Object.freeze({ windowMs: HOUR_MS, limit: 5 }),
  perAddress: Object.freeze({ windowMs: HOUR_MS, limit: 20 }),
  perAddressDaily: Object.freeze({ windowMs: DAY_MS, limit: 25 }),
  site: Object.freeze({ windowMs: DAY_MS, limit: SITE_DAILY_LIMIT }),
});

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const invalid = (field, message) => new ValidationError(message, { details: { field } });

/** A check that the value is one of a list. */
const oneOf = (list, field) => (value) => {
  if (!list.includes(value)) throw invalid(field, `${field} must be one of ${list.join(", ")}`);
  return value;
};

// Control characters other than a new line or a tab. Nobody means to type them, and some move the cursor in a
// terminal the owner might read an export in.
const CONTROL = /[^\P{Cc}\n\t]/gu;

/** The message as plain text: Windows new lines become one, control characters go, and the ends are trimmed. */
function parseMessage(value) {
  if (typeof value !== "string" || value.length > FEEDBACK_MESSAGE_MAX) {
    throw invalid("message", `Write a message of at most ${FEEDBACK_MESSAGE_MAX} characters`);
  }
  const message = value.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
  if (message === "") throw invalid("message", "Write a message");
  return message;
}

// The page builds the route pattern itself, and this is the second check, with the same shared rule.
function parsePage(value) {
  if (!isFeedbackPage(value)) {
    throw invalid("page", "page must be a route pattern without codes, names or a query");
  }
  return value;
}

const BUILD_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;

function parseBuild(value) {
  if (typeof value !== "string" || !BUILD_PATTERN.test(value)) {
    throw invalid("build", "build must be a version such as 0.1.0+abc1234");
  }
  return value;
}

function parseReplyEmail(value) {
  try {
    return parseEmail(value);
  } catch (err) {
    throw new ValidationError("Enter a valid email address, or leave it empty", {
      details: { field: "replyEmail" },
      cause: err,
    });
  }
}

/**
 * Every field the page may send, and how each is checked. A new field is one line here, one in the store's schema
 * and one in the page's context (ADR-059). Nothing else is taken: a player id, a user agent or anything the page
 * does not mean to send is refused.
 */
const REQUIRED_FIELDS = Object.freeze({
  type: oneOf(FEEDBACK_TYPES, "type"),
  message: parseMessage,
  page: parsePage,
  build: parseBuild,
  device: oneOf(FEEDBACK_DEVICES, "device"),
});
const OPTIONAL_FIELDS = Object.freeze({ replyEmail: parseReplyEmail });

/** @returns {import("../../domain/feedback/feedbackComponent.js").FeedbackInput} */
function parseFeedback(body) {
  if (!isPlainObject(body)) throw new ValidationError("Send a JSON object");
  const known = [...Object.keys(REQUIRED_FIELDS), ...Object.keys(OPTIONAL_FIELDS)];
  const unknown = Object.keys(body).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown fields", { details: { fields: unknown } });
  }
  const required = Object.entries(REQUIRED_FIELDS).map(([field, parse]) => [field, parse(body[field])]);
  const optional = Object.entries(OPTIONAL_FIELDS)
    .filter(([field]) => body[field] !== undefined)
    .map(([field, parse]) => [field, parse(body[field])]);
  return Object.fromEntries([...required, ...optional]);
}

/** Who is sending, from the session alone. The page never says. */
function senderOf(session) {
  if (session.identity === undefined) return { kind: FEEDBACK_KIND.VISITOR };
  const identity = requireIdentity(session);
  const kind = identity.kind === IDENTITY_KINDS.USER ? FEEDBACK_KIND.ACCOUNT : FEEDBACK_KIND.GUEST;
  return { kind, playerId: identity.id };
}

const INBOX_QUERY = Object.freeze({
  type: oneOf(FEEDBACK_TYPES, "type"),
  status: oneOf(FEEDBACK_STATUSES, "status"),
});
const CURSOR_PATTERN = /^(\d{1,15})_([0-9a-f-]{36})$/;

/** The cursor the inbox hands out for its next page: when the last item was sent, and its id. */
const cursorText = ({ createdAt, feedbackId }) => `${createdAt}_${feedbackId}`;

function parseCursor(value) {
  const match = typeof value === "string" ? CURSOR_PATTERN.exec(value) : null;
  if (match === null || !UUID_PATTERN.test(match[2])) throw invalid("before", "Invalid cursor");
  return { createdAt: Number(match[1]), feedbackId: match[2] };
}

/** The inbox's filters and cursor. Anything else in the query is refused, so a typo is never silently ignored. */
function parseInboxQuery(query) {
  const unknown = Object.keys(query).filter((key) => key !== "before" && !(key in INBOX_QUERY));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown query parameters", { details: { fields: unknown } });
  }
  const where = Object.fromEntries(
    Object.entries(INBOX_QUERY)
      .filter(([key]) => query[key] !== undefined)
      .map(([key, parse]) => [key, parse(query[key])]),
  );
  return { where, ...(query.before !== undefined && { before: parseCursor(query.before) }) };
}

function parseFeedbackId(params) {
  if (!UUID_PATTERN.test(params.feedbackId)) throw invalid("feedbackId", "Invalid feedback id");
  return params.feedbackId;
}

function parseStatusChange(params, body) {
  const feedbackId = parseFeedbackId(params);
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "status")) {
    throw new ValidationError("Send only the new status", { details: { fields: ["status"] } });
  }
  return { feedbackId, status: oneOf(FEEDBACK_STATUSES, "status")(body.status) };
}

/**
 * In-app feedback (CC-290, ADR-059).
 *
 * 1. `POST /feedback` with `{ type, message, page, build, device, replyEmail? }` from anyone, visitors included,
 *    answers 201 `{ feedback: { feedbackId, status, createdAt } }`. 400 for anything else in the body, 429 over a
 *    limit. The kind of sender comes from the session.
 * 2. `GET /feedback/form` answers `{ form: { replyEmail } }`: whether this sender may leave an email for a reply.
 * 3. `GET /admin/feedback?type=&status=&before=` answers an admin `{ items, next? }`, newest first, 50 at a time,
 *    without reply emails (`hasReplyEmail` says whether there is one).
 * 4. `GET /admin/feedback/:feedbackId` answers an admin `{ item }` with everything, the reply email included.
 * 5. `PATCH /admin/feedback/:feedbackId` with `{ status }` answers an admin `{ item }` as the list shows it.
 * 6. `DELETE /admin/feedback/:feedbackId` deletes the item for good and answers an admin 204.
 *    Everyone else gets the console's 404 on all four (ADR-036).
 *
 * @param {{
 *   feedbackComponent: ReturnType<typeof import("../../domain/feedback/feedbackComponent.js").createFeedbackComponent>,
 *   requireAdmin: import("express").RequestHandler,
 *   now?: () => number,
 *   limits?: Partial<typeof FEEDBACK_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createFeedbackRoutes({ feedbackComponent, requireAdmin, now = Date.now, limits = {} }) {
  assertDefined(feedbackComponent, "feedbackComponent");
  assertFunction(requireAdmin, "requireAdmin");
  const rules = { ...FEEDBACK_LIMITS, ...limits };
  const router = Router();

  // A visitor has no lasting session, so only the address and the site limits count them.
  const perSession = createRateLimit({
    ...rules.perSession,
    message: "You have sent a lot of feedback, thank you! Try again in an hour",
    keyGenerator: (req) => `session:${req.sessionID}`,
    skip: (req) => req.session.identity === undefined,
  });
  const perAddress = createRateLimit({
    ...rules.perAddress,
    message: "A lot of feedback came from your network, try again in an hour",
    headers: false,
  });
  const perAddressDaily = createRateLimit({
    ...rules.perAddressDaily,
    message: "A lot of feedback came from your network today, try again tomorrow",
    keyGenerator: (req) => `net48:${ipKeyGenerator(/** @type {string} */ (req.ip), DAILY_IPV6_BLOCK)}`,
    headers: false,
  });
  const site = createRateLimit({
    ...rules.site,
    message: "We have had a lot of feedback today, try again tomorrow",
    keyGenerator: () => "site",
    skipFailedRequests: true,
    headers: false,
  });

  // The session's own limit first, so the address counts only what it let through, and the site only what was stored.
  router.post("/feedback", perSession, perAddress, perAddressDaily, site, async (req, res) => {
    const feedback = parseFeedback(req.body);
    const sender = senderOf(req.session);
    const sent = await feedbackComponent.submit({ sender, feedback, now: now() });
    // Nothing about who sent it is logged, and never the message.
    req.log.info({ feedbackType: feedback.type }, "feedback received");
    res.status(201).json({ feedback: sent });
  });

  router.get("/feedback/form", async (req, res) => {
    const replyEmail = await feedbackComponent.canAskForReply({ sender: senderOf(req.session), now: now() });
    res.set("Cache-Control", "no-store");
    res.json({ form: { replyEmail } });
  });

  router.get("/admin/feedback", requireAdmin, async (req, res) => {
    const { where, before } = parseInboxQuery(req.query);
    const { items, next } = await feedbackComponent.list({
      where,
      limit: PAGE_SIZE,
      ...(before !== undefined && { before }),
    });
    res.json({ items, ...(next !== undefined && { next: cursorText(next) }) });
  });

  router.get("/admin/feedback/:feedbackId", requireAdmin, async (req, res) => {
    const item = await feedbackComponent.get({ feedbackId: parseFeedbackId(req.params) });
    res.json({ item });
  });

  router.delete("/admin/feedback/:feedbackId", requireAdmin, async (req, res) => {
    await feedbackComponent.remove({ feedbackId: parseFeedbackId(req.params) });
    req.log.info("feedback deleted");
    res.status(204).end();
  });

  router.patch("/admin/feedback/:feedbackId", requireAdmin, async (req, res) => {
    const change = parseStatusChange(req.params, req.body);
    const item = await feedbackComponent.setStatus({ ...change, now: now() });
    res.json({ item });
  });

  return router;
}
