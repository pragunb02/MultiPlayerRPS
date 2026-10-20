import { Router } from "express";
import { assertDefined } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { parseReference, REFERENCE_KIND, UUID_PATTERN } from "./playerReferenceInput.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const MINUTE_MS = 60 * 1000;

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

/**
 * Who to block: `{ roomCode, seat, seatId }`, `{ matchId, seat }` or `{ reportId }` (a report the caller made,
 * ADR-071.4), and nothing else. Never a player id (playerReferenceInput.js).
 *
 * @returns {import("../../domain/blocks/blockComponent.js").BlockTarget}
 */
const parseTarget = (body) =>
  /** @type {import("../../domain/blocks/blockComponent.js").BlockTarget} */ (
    parseReference(body, {
      kinds: [REFERENCE_KIND.ROOM, REFERENCE_KIND.MATCH, REFERENCE_KIND.REPORT],
      message: "Send a room code or a match id, and a seat",
    })
  );

/**
 * Blocks (CC-044, ADR-053), for guests and accounts alike. Visitors get 401.
 *
 * 1. `GET /blocks` answers `{ blocks: [{ blockId, displayName, blockedAt }] }`, the player's own blocks, newest first.
 * 2. `POST /blocks` with `{ roomCode, seat, seatId }`, `{ matchId, seat }` or `{ reportId }` blocks the player in that
 *    seat or of that report, and answers `{ block }`. Anyone the server did not see the caller play with or report
 *    gets 404.
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

  // The player's own limit first, so the network's budget counts only what it let through. One player hammering the
  // route can then use up at most their own share of a school's or a carrier's address.
  router.post("/blocks", signedIn, perPlayer, perAddress, async (req, res) => {
    const target = parseTarget(req.body);
    const blocker = requireIdentity(req.session);
    const block = await blockComponent.block({ blocker, target, now: now() });
    // Who was blocked is never logged: only the database holds it, for as long as the block lasts.
    req.log.info({ playerId: blocker.id }, "player blocked");
    res.json({ block });
  });

  router.delete("/blocks/:blockId", signedIn, perPlayer, perAddress, async (req, res) => {
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
