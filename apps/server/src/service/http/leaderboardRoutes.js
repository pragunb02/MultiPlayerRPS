import { Router } from "express";
import { LEADERBOARD_MAX_ENTRIES } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

// Public reads: generous for people browsing, but a scraper looping on them is slowed down.
const DEFAULT_LIMIT = Object.freeze({ windowMs: 60 * 1000, limit: 120 });

/** @param {import("express").Request["query"]} query */
function parseQuery(query) {
  const unknown = Object.keys(query).filter((key) => key !== "limit");
  if (unknown.length > 0) {
    throw new ValidationError("Unknown query parameters", { details: { fields: unknown } });
  }
  const limit = query.limit === undefined ? LEADERBOARD_MAX_ENTRIES : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > LEADERBOARD_MAX_ENTRIES) {
    throw new ValidationError(`limit must be an integer from 1 to ${LEADERBOARD_MAX_ENTRIES}`, {
      details: { field: "limit" },
    });
  }
  return { limit };
}

/**
 * Leaderboards (CC-053) — public: no session needed. With a session, `you` says where the viewer stands.
 *
 *   GET /leaderboards                    → { boards: [{ id, name, metric, period }] }
 *   GET /leaderboards/:boardId?limit=50  → { board: { id, name, metric, period, periodId, resetsAt? },
 *                                            entries: [{ rank, displayName, level, score }],
 *                                            you?: { listed: true, rank, score } | { listed: false, reason } }
 *                                          404 NOT_FOUND for an unknown board
 *
 * @param {{
 *   leaderboardComponent: ReturnType<typeof import("../../domain/leaderboards/leaderboardComponent.js").createLeaderboardComponent>,
 *   limit?: { windowMs: number, limit: number },
 *   now?: () => number,
 * }} deps
 */
export function createLeaderboardRoutes({ leaderboardComponent, limit = DEFAULT_LIMIT, now = Date.now }) {
  assertDefined(leaderboardComponent, "leaderboardComponent");
  const router = Router();
  const readLimit = createRateLimit({ ...limit, message: "Too many requests, try again later" });

  router.get("/leaderboards", readLimit, (req, res) => {
    res.json({ boards: leaderboardComponent.listBoards() });
  });

  router.get("/leaderboards/:boardId", readLimit, async (req, res) => {
    const { limit: size } = parseQuery(req.query);
    const at = now();
    const { boardId } = req.params;
    const { board, entries } = await leaderboardComponent.getBoard({ boardId, limit: size, now: at });
    if (req.session.identity === undefined) {
      res.json({ board, entries });
      return;
    }
    const viewer = requireIdentity(req.session);
    // `you` belongs to one person, so no shared cache may keep this answer and hand it to someone else.
    res.set("Cache-Control", "private, no-store");
    res.json({ board, entries, you: await leaderboardComponent.standingFor({ boardId, viewer, now: at }) });
  });

  return router;
}
