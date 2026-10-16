import { Router } from "express";
import { assertDefined } from "../../utils/assert.js";
import { requireIdentity } from "./session.js";

/**
 * The signed-in player's progression.
 *
 *   GET /progress → { progress: { xp, level, xpIntoLevel, xpForNextLevel, matchesPlayed, wins, losses, draws } }
 *
 * @param {{ progressionComponent: ReturnType<typeof import("../../domain/progression/progressionComponent.js").createProgressionComponent> }} deps
 */
export function createProgressRoutes({ progressionComponent }) {
  assertDefined(progressionComponent, "progressionComponent");
  const router = Router();

  router.get("/progress", async (req, res) => {
    const { id } = requireIdentity(req.session);
    res.json({ progress: await progressionComponent.getProgress(id) });
  });

  return router;
}
