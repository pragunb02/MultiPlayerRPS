import { Router } from "express";
import { CHESS_PROMOTIONS, DAILY_PUZZLE_KINDS } from "@classicade/shared";
import { isDay } from "../../utils/indiaTime.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { createRateLimit } from "./rateLimits.js";
import { requireIdentity } from "./session.js";

const MINUTE_MS = 60 * 1000;
const SQUARE = /^[a-h][1-8]$/;

/**
 * Moves and hints per player per minute (ADR-061). A puzzle has at most a handful of moves and three mistakes, so a
 * player never comes near it. It stops a script from hammering the referee. Tests may change it.
 */
export const DAILY_PUZZLE_LIMIT = Object.freeze({ windowMs: MINUTE_MS, limit: 30 });

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Refuses anything but a JSON object with exactly the allowed fields, and answers its day. */
function parseBody(body, fields) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Send a JSON object");
  }
  const unknown = Object.keys(body).filter((key) => !fields.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Unknown fields", { details: { fields: unknown } });
  }
  if (!isDay(body.day)) {
    throw new ValidationError("Say which day's puzzle, as YYYY-MM-DD", { details: { field: "day" } });
  }
  return body;
}

/** A chess move: two squares, and the piece a pawn becomes when it reaches the last rank. */
function parseChessMove(body) {
  const { day, from, to, promotion } = parseBody(body, ["day", "from", "to", "promotion"]);
  for (const [field, square] of [
    ["from", from],
    ["to", to],
  ]) {
    if (typeof square !== "string" || !SQUARE.test(square)) {
      throw new ValidationError(`${field} must be a square such as e4`, { details: { field } });
    }
  }
  if (promotion !== undefined && !CHESS_PROMOTIONS.includes(promotion)) {
    throw new ValidationError(`promotion must be one of ${CHESS_PROMOTIONS.join(", ")}`, {
      details: { field: "promotion" },
    });
  }
  return { day, move: { from, to, ...(promotion !== undefined && { promotion }) } };
}

/** How each kind's move looks in a request. A new kind adds its parser here. */
const MOVE_PARSERS = Object.freeze({ [DAILY_PUZZLE_KINDS.CHESS]: parseChessMove });

/**
 * The daily puzzles (CC-144, ADR-061), for guests and accounts alike. Every answer is `Cache-Control: no-store`.
 *
 * 1. `GET /daily/:kind` answers `{ puzzle }`, today's puzzle. Visitors see it too, without an attempt or a streak.
 * 2. `POST /daily/:kind/moves` with `{ day, from, to, promotion? }` plays a move and answers
 *    `{ outcome, played, reply?, puzzle }`. An illegal move is 400 and costs nothing.
 * 3. `POST /daily/:kind/hints` with `{ day }` answers `{ hint, puzzle }`.
 *
 * Moves and hints need a session (401 without one). A day that is no longer today, an attempt that has ended, no
 * hints left and a change in another tab are 409, with the reason in `details.reason`. An unknown kind is 404.
 *
 * @param {{
 *   dailyPuzzleComponent: ReturnType<typeof import("../../domain/dailyPuzzles/dailyPuzzleComponent.js").createDailyPuzzleComponent>,
 *   now: () => number,
 *   limit?: { windowMs: number, limit: number },
 * }} deps
 */
export function createDailyPuzzleRoutes({ dailyPuzzleComponent, now, limit = DAILY_PUZZLE_LIMIT }) {
  assertDefined(dailyPuzzleComponent, "dailyPuzzleComponent");
  assertFunction(now, "now");
  const router = Router();

  const knownKind = (req, res, next) => {
    if (!dailyPuzzleComponent.hasKind(req.params.kind) || !Object.hasOwn(MOVE_PARSERS, req.params.kind)) {
      throw new NotFoundError("There is no such daily puzzle");
    }
    res.set("Cache-Control", "no-store");
    next();
  };
  // Signed in first, so a visitor is told 401 and is never counted.
  const signedIn = (req, res, next) => {
    requireIdentity(req.session);
    next();
  };
  const perPlayer = createRateLimit({
    ...limit,
    message: "Too many puzzle moves, wait a minute",
    keyGenerator: (req) => `player:${requireIdentity(req.session).id}`,
  });

  router.get("/daily/:kind", knownKind, async (req, res) => {
    const { kind } = req.params;
    const puzzle =
      req.session?.identity === undefined
        ? await dailyPuzzleComponent.today({ kind, now: now() })
        : await dailyPuzzleComponent.todayFor({
            kind,
            playerId: requireIdentity(req.session).id,
            now: now(),
          });
    res.json({ puzzle });
  });

  router.post("/daily/:kind/moves", knownKind, signedIn, perPlayer, async (req, res) => {
    const { kind } = req.params;
    const { day, move } = MOVE_PARSERS[kind](req.body);
    const { id: playerId } = requireIdentity(req.session);
    const answer = await dailyPuzzleComponent.play({ kind, playerId, day, move, now: now() });
    req.log.info({ playerId, kind, day, outcome: answer.outcome }, "daily puzzle move");
    res.json(answer);
  });

  router.post("/daily/:kind/hints", knownKind, signedIn, perPlayer, async (req, res) => {
    const { kind } = req.params;
    const { day } = parseBody(req.body, ["day"]);
    const { id: playerId } = requireIdentity(req.session);
    const answer = await dailyPuzzleComponent.takeHint({ kind, playerId, day, now: now() });
    req.log.info({ playerId, kind, day }, "daily puzzle hint");
    res.json(answer);
  });

  return router;
}
