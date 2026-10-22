import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { createRateLimit } from "./rateLimits.js";
import { NO_SERVER_EVENTS } from "./telemetryRoutes.js";
import { destroySession, establishSession, requireIdentity, SESSION_COOKIE_NAME } from "./session.js";

// Each guest session is a stored document; cap how fast one client can create them.
const DEFAULT_GUEST_LIMIT = Object.freeze({ windowMs: 15 * 60 * 1000, limit: 30 });

/**
 * Session endpoints. Identity is created and read only here, on the server; nothing a client sends
 * can choose or change who they are.
 *
 *   GET    /session        → 200 { authenticated: true, identity, admin? } | 200 { authenticated: false } (no session yet —
 *                             a normal state for a first visit, not an error) | 401 (a session with a corrupt identity)
 *   POST   /session/guest  → 201 { identity } (new guest) | 200 { identity } (already has one)
 *   DELETE /session        → 204 (ends the session and disconnects its sockets)
 *
 * @param {{
 *   identityComponent: ReturnType<typeof import("../../domain/identity/identityComponent.js").createIdentityComponent>,
 *   onSessionEnded: (sessionId: string) => void,
 *   onIdentityChanged: (change: { previous: object | undefined, identity: object | undefined }) => Promise<unknown>,  told about logouts
 *   guestLimit?: { windowMs: number, limit: number },
 *   isAdmin: (sessionData: object) => boolean,   whether the owner console is open to this session. Only then does
 *     the answer carry `admin: true`, so nobody else learns that a console exists (CC-233)
 *   serverEvents?: { record: Function },   anonymous counts of new guests and logouts (CC-175)
 * }} deps
 */
export function createSessionRoutes({
  identityComponent,
  onSessionEnded,
  onIdentityChanged,
  guestLimit = DEFAULT_GUEST_LIMIT,
  isAdmin,
  serverEvents = NO_SERVER_EVENTS,
}) {
  assertDefined(identityComponent, "identityComponent");
  assertFunction(onSessionEnded, "onSessionEnded");
  assertFunction(onIdentityChanged, "onIdentityChanged");
  assertFunction(isAdmin, "isAdmin");

  const router = Router();
  const guestRateLimit = createRateLimit({ ...guestLimit, message: "Too many requests, try again later" });

  router.get("/session", (req, res) => {
    if (req.session.identity === undefined) {
      res.json({ authenticated: false });
      return;
    }
    const identity = requireIdentity(req.session);
    res.json({ authenticated: true, identity, ...(isAdmin(req.session) && { admin: true }) });
  });

  router.post("/session/guest", guestRateLimit, async (req, res) => {
    if (req.session.identity !== undefined) {
      res.json({ identity: requireIdentity(req.session) });
      return;
    }
    const identity = identityComponent.createGuest();
    await establishSession(req, identity);
    req.log.info({ playerId: identity.id }, "guest session created");
    res.status(201).json({ identity });
    serverEvents.record(req, "guest_started");
  });

  router.delete("/session", async (req, res) => {
    const sessionId = req.sessionID;
    const previous = req.session.identity;
    const ended = { identity: previous };
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE_NAME);
    if (previous !== undefined) {
      await onIdentityChanged({ previous, identity: undefined });
      onSessionEnded(sessionId);
    }
    res.status(204).end();
    if (previous !== undefined)
      serverEvents.record(req, "session_ended", { cause: "logout" }, { session: ended });
  });

  return router;
}
