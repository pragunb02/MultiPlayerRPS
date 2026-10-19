import { Router } from "express";
import { parseRoomCode } from "../../models/roomCode.js";
import { assertDefined } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const MINUTE_MS = 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Seats are positions in a room or a match. No game has more than a few players.
const MAX_SEAT = 7;

/**
 * The limits on blocking and unblocking together (ADR-053). Each is a business rule, and tests and browser tests
 * may change them.
 *
 * 1. `perPlayer`: changes per player in 10 minutes. Far more than anyone needs after a few games, and too few to
 *    probe rooms or matches with.
 * 2. `perAddress`: changes per network address in 10 minutes, so making new guests buys no more.
 */
export const BLOCK_LIMITS = Object.freeze({
  perPlayer: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 20 }),
  perAddress: Object.freeze({ windowMs: 10 * MINUTE_MS, limit: 100 }),
});

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Who to block: `{ roomCode, seat }` or `{ matchId, seat }`, and nothing else. A player id is never accepted, so
 * nobody can name a player they never met.
 *
 * @returns {import("../../domain/blocks/blockComponent.js").BlockTarget}
 */
function parseTarget(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const reference = "roomCode" in body ? "roomCode" : "matchId";
  const unknown = Object.keys(body).filter((key) => key !== reference && key !== "seat");
  if (unknown.length > 0) {
    throw new ValidationError("Send a room code or a match id, and a seat", { details: { fields: unknown } });
  }
  const { seat } = body;
  if (!Number.isInteger(seat) || seat < 0 || seat > MAX_SEAT) {
    throw new ValidationError(`seat must be a whole number from 0 to ${MAX_SEAT}`, {
      details: { field: "seat" },
    });
  }
  if (reference === "roomCode") {
    return { roomCode: parseRoomCode(body.roomCode), seat };
  }
  if (typeof body.matchId !== "string" || !UUID_PATTERN.test(body.matchId)) {
    throw new ValidationError("Invalid match id", { details: { field: "matchId" } });
  }
  return { matchId: body.matchId, seat };
}

/**
 * Blocks (CC-044, ADR-053), for guests and accounts alike. Visitors get 401.
 *
 * 1. `GET /blocks` answers `{ blocks: [{ blockId, displayName, blockedAt }] }`, the player's own blocks, newest first.
 * 2. `POST /blocks` with `{ roomCode, seat }` or `{ matchId, seat }` blocks the player in that seat, and answers
 *    `{ block }`. Anyone the server did not see the caller play with gets 404.
 * 3. `DELETE /blocks/:blockId` removes one of the player's own blocks and answers 204. Anyone else's gets 404.
 *
 * @param {{
 *   blockComponent: Pick<ReturnType<typeof import("../../domain/blocks/blockComponent.js").createBlockComponent>, "block" | "unblock" | "listFor">,
 *   now?: () => number,
 *   limits?: Partial<typeof BLOCK_LIMITS>,   any limit not given keeps its standard value
 * }} deps
 */
export function createBlockRoutes({ blockComponent, now = Date.now, limits = {} }) {
  assertDefined(blockComponent, "blockComponent");
  const rules = { ...BLOCK_LIMITS, ...limits };
  const router = Router();

  // Signed in first, so a visitor is told 401 and is never counted.
  const signedIn = (req, res, next) => {
    requireIdentity(req.session);
    next();
  };
  // One budget for blocking and unblocking, so switching between them buys nothing.
  const perPlayer = createRateLimit({
    ...rules.perPlayer,
    message: "Too many changes to your blocked players, try again later",
    keyGenerator: (req) => `player:${requireIdentity(req.session).id}`,
  });
  const perAddress = createRateLimit({
    ...rules.perAddress,
    message: "Too many changes to blocked players from your network, try again later",
    headers: false,
  });

  router.get("/blocks", signedIn, async (req, res) => {
    const { id: blockerId } = requireIdentity(req.session);
    res.set("Cache-Control", "no-store");
    res.json({ blocks: await blockComponent.listFor({ blockerId }) });
  });

  router.post("/blocks", signedIn, perAddress, perPlayer, async (req, res) => {
    const target = parseTarget(req.body);
    const blocker = requireIdentity(req.session);
    const block = await blockComponent.block({ blocker, target, now: now() });
    // Who was blocked is never logged: only the database holds it, for as long as the block lasts.
    req.log.info({ playerId: blocker.id }, "player blocked");
    res.json({ block });
  });

  router.delete("/blocks/:blockId", signedIn, perAddress, perPlayer, async (req, res) => {
    const { blockId } = req.params;
    if (!UUID_PATTERN.test(blockId)) {
      throw new ValidationError("Invalid block id", { details: { field: "blockId" } });
    }
    const { id: blockerId } = requireIdentity(req.session);
    await blockComponent.unblock({ blockerId, blockId });
    req.log.info({ playerId: blockerId }, "player unblocked");
    res.status(204).end();
  });

  return router;
}
