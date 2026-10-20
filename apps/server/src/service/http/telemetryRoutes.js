import express, { Router } from "express";
import { IDENTITY_KINDS, TELEMETRY_PLAYER_KINDS } from "@classicade/shared";
import { isBotAgent } from "../../domain/telemetry/botAgents.js";
import { TELEMETRY_DROP_REASONS } from "../../domain/telemetry/telemetryLimits.js";
import { checkBatch } from "../../domain/telemetry/telemetryValidator.js";
import { isDay } from "../../utils/indiaTime.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { clientIpKey, createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

/** Where browsers send their batches, under `/api` (CC-175). */
export const TELEMETRY_PATH = "/telemetry";

/** The body types a batch may come in: `fetch` sends JSON, `navigator.sendBeacon` sends a string as text/plain. */
export const TELEMETRY_BODY_TYPES = Object.freeze(["application/json", "text/plain"]);

const REASONS = TELEMETRY_DROP_REASONS;

/**
 * Whether the browser asks not to be counted: Global Privacy Control (`Sec-GPC: 1`) or Do Not Track (`DNT: 1`).
 * Such a request is dropped before its body is read (EVENTS.md 1.6).
 *
 * @param {import("express").Request} req
 */
export const optsOut = (req) => req.get("Sec-GPC") === "1" || req.get("DNT") === "1";

/**
 * The kind of player a session holds, as telemetry names it. Never the id.
 *
 * @param {Partial<import("express-session").SessionData>} session
 * @returns {string} a TELEMETRY_PLAYER_KINDS value
 */
function playerKindOf(session) {
  if (session.identity === undefined) return TELEMETRY_PLAYER_KINDS.VISITOR;
  return requireIdentity(session).kind === IDENTITY_KINDS.USER
    ? TELEMETRY_PLAYER_KINDS.ACCOUNT
    : TELEMETRY_PLAYER_KINDS.GUEST;
}

/**
 * Who is asking, as the flag rules need it. A visitor is `undefined`.
 *
 * @param {import("express").Request} req
 * @param {(session: object) => boolean} isAdmin
 */
function flagPlayerOf(req, isAdmin) {
  if (req.session.identity === undefined) return undefined;
  const { id, kind } = requireIdentity(req.session);
  return { id, kind, admin: isAdmin(req.session) };
}

/**
 * The batch body, read as text up to the size limit, before the app's own JSON parser (CC-175). A body over the
 * limit, or one that cannot be read, is answered 204 at once and counted as `invalid`, so it costs nothing more.
 *
 * @param {{ maxBytes: number, onRejected: () => void }} options
 * @returns {import("express").RequestHandler}
 */
export function createTelemetryBodyParser({ maxBytes, onRejected }) {
  const read = express.text({ type: [...TELEMETRY_BODY_TYPES], limit: maxBytes });
  return (req, res, next) => {
    if (req.method !== "POST") {
      next();
      return;
    }
    read(req, res, (error) => {
      if (error !== undefined) {
        onRejected();
        res.status(204).end();
        return;
      }
      next();
    });
  };
}

/** The parsed JSON of a body read as text, or undefined when it is not JSON. */
function parsed(body) {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * Events the server records itself (EVENTS.md 3.3 and 3.5: sign-ups, logins, sessions ending, new guests, server
 * errors), through the same catalogue and the same rules as a browser's: none when the request opts out with GPC
 * or DNT, none from an admin, none while `telemetry_ingest` is off. Recording never delays or fails the request
 * it is about: it runs after, and a failure is logged without anything about the player.
 *
 * @param {{
 *   telemetryComponent: ReturnType<typeof import("../../domain/telemetry/telemetryComponent.js").createTelemetryComponent>,
 *   flagComponent: Pick<ReturnType<typeof import("../../domain/flags/flagComponent.js").createFlagComponent>, "isOn">,
 *   isAdmin: (session: object) => boolean,
 * }} deps
 */
export function createServerEvents({ telemetryComponent, flagComponent, isAdmin }) {
  assertDefined(telemetryComponent, "telemetryComponent");
  assertFunction(flagComponent?.isOn, "flagComponent.isOn");
  assertFunction(isAdmin, "isAdmin");

  async function write(req, name, fields, session) {
    if (optsOut(req) || isAdmin(session)) return;
    if (!(await flagComponent.isOn("telemetry_ingest", flagPlayerOf({ session }, isAdmin)))) return;
    await telemetryComponent.record({ name, player_kind: playerKindOf(session), ...fields });
  }

  return Object.freeze({
    /**
     * Records one event about this request, after it. The session is read as it is now, or as given (a logout
     * reads the session that ended).
     *
     * @param {import("express").Request} req
     * @param {string} name  a server event of the catalogue
     * @param {Record<string, string | number | boolean>} [fields]
     * @param {{ session?: Partial<import("express-session").SessionData> }} [options]
     */
    record(req, name, fields = {}, { session = req.session } = {}) {
      write(req, name, fields, session).catch((error) =>
        req.log.error({ err: error }, "recording a telemetry event failed"),
      );
    },
  });
}

/** Server events off: for tests and tools that wire no telemetry. */
export const NO_SERVER_EVENTS = Object.freeze({ record: () => undefined });

/**
 * Telemetry over HTTP (CC-175, ADR-034).
 *
 *   POST   /telemetry                    always 204 with no body, whatever was kept, so the answer says nothing
 *     body `{ build, events: [{ name, route, device, player_kind, ...fields }] }`, JSON or text/plain
 *   DELETE /admin/telemetry?before=YYYY-MM-DD   200 { deleted }: deletes stored events that arrived before that India
 *     day. Admins only, everyone else gets the console's 404 (ADR-036)
 *
 * In order, before anything is stored: GPC or DNT, an admin's session, a known bot, the `telemetry_ingest` flag off,
 * then 30 batches per 10 minutes per network. Each drops the whole batch and counts one. Then each event is checked
 * on its own, and the day's cap applies.
 *
 * @param {{
 *   telemetryComponent: ReturnType<typeof import("../../domain/telemetry/telemetryComponent.js").createTelemetryComponent>,
 *   flagComponent: Pick<ReturnType<typeof import("../../domain/flags/flagComponent.js").createFlagComponent>, "isOn" | "recordSuccess">,
 *   adminAccess: ReturnType<typeof import("./adminAccess.js").createAdminAccess>,
 * }} deps
 */
export function createTelemetryRoutes({ telemetryComponent, flagComponent, adminAccess }) {
  assertDefined(telemetryComponent, "telemetryComponent");
  assertFunction(flagComponent?.isOn, "flagComponent.isOn");
  assertFunction(adminAccess?.isAdmin, "adminAccess.isAdmin");
  const { limits } = telemetryComponent;
  const router = Router();
  const done = (res) => res.status(204).end();

  /** @type {import("express").RequestHandler} */
  async function dropUnwanted(req, res, next) {
    const drop = (reason) => {
      telemetryComponent.dropped(reason, 1);
      done(res);
    };
    if (optsOut(req)) return drop(REASONS.OPTED_OUT);
    if (adminAccess.isAdmin(req.session)) return drop(REASONS.ADMIN);
    // Read in memory for this check only: never stored, logged or sent.
    if (isBotAgent(req.get("User-Agent"))) return drop(REASONS.BOT);
    if (!(await flagComponent.isOn("telemetry_ingest", flagPlayerOf(req, adminAccess.isAdmin)))) {
      return drop(REASONS.FLAG_OFF);
    }
    return next();
  }

  const perNetwork = createRateLimit({
    ...limits.batches,
    message: "",
    keyGenerator: clientIpKey,
    headers: false,
    onLimited: (req, res) => {
      telemetryComponent.dropped(REASONS.RATE_LIMITED, 1);
      done(res);
    },
  });

  router.post(TELEMETRY_PATH, dropUnwanted, perNetwork, async (req, res) => {
    const batch = checkBatch(parsed(req.body), { maxEvents: limits.eventsPerBatch });
    telemetryComponent.dropped(REASONS.INVALID, batch.invalid);
    if (batch.build !== undefined && batch.events.length > 0) {
      try {
        const stored = await telemetryComponent.storeBatch({ build: batch.build, events: batch.events });
        if (stored > 0) {
          await flagComponent.recordSuccess("telemetry_ingest", flagPlayerOf(req, adminAccess.isAdmin));
        }
      } catch (error) {
        // The answer stays 204: a browser never retries a batch, and the failure is ours to see in the logs.
        req.log.error({ err: error }, "storing telemetry failed");
      }
    }
    done(res);
  });

  router.delete(`/admin${TELEMETRY_PATH}`, adminAccess.requireAdmin, async (req, res) => {
    const unknown = Object.keys(req.query).filter((key) => key !== "before");
    if (unknown.length > 0 || !isDay(req.query.before)) {
      throw new ValidationError("Give the day as before=YYYY-MM-DD, and nothing else", {
        details: { field: "before" },
      });
    }
    const deleted = await telemetryComponent.purgeBefore(/** @type {string} */ (req.query.before));
    req.log.info({ deleted }, "telemetry purged");
    res.json({ deleted });
  });

  return router;
}
