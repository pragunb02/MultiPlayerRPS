import { Router } from "express";
import { assertDefined } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { requireIdentity } from "./session.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @param {import("express").Request["query"]} query */
function parsePage(query) {
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_LIMIT}`, {
      details: { field: "limit" },
    });
  }
  if (query.before === undefined) {
    return { limit };
  }
  const before = Number(query.before);
  if (!Number.isInteger(before) || before <= 0) {
    throw new ValidationError("before must be a timestamp in milliseconds", { details: { field: "before" } });
  }
  return { limit, before };
}

/**
 * Match history for the signed-in player (guest or user).
 *
 *   GET /matches?limit=20&before=<endedAt ms>  → { matches, nextBefore? }   newest first
 *   GET /matches/:matchId                      → full record incl. move log (participants only)
 *
 * @param {{ matchComponent: ReturnType<typeof import("../../domain/matches/matchComponent.js").createMatchComponent>, now?: () => number }} deps
 */
export function createMatchRoutes({ matchComponent, now = Date.now }) {
  assertDefined(matchComponent, "matchComponent");
  const router = Router();

  router.get("/matches", async (req, res) => {
    const { id: playerId } = requireIdentity(req.session);
    const page = parsePage(req.query);
    const matches = await matchComponent.listForPlayer({ playerId, ...page, now: now() });
    const full = matches.length === page.limit;
    res.json({ matches, ...(full && { nextBefore: matches.at(-1).endedAt }) });
  });

  router.get("/matches/:matchId", async (req, res) => {
    const { id: playerId } = requireIdentity(req.session);
    if (!MATCH_ID_PATTERN.test(req.params.matchId)) {
      throw new ValidationError("Invalid match id", { details: { field: "matchId" } });
    }
    res.json({
      match: await matchComponent.getForPlayer({ matchId: req.params.matchId, playerId, now: now() }),
    });
  });

  return router;
}
