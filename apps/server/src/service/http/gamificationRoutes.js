import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { requireIdentity } from "./session.js";

/**
 * The signed-in player's achievements, streaks and daily quests (CC-054, CC-089). Guests have them too.
 *
 *   GET /achievements → { achievements: [{ id, name, description, icon, tier, unlockedAt, progress: { current, target } }] }
 *   GET /streaks      → { streaks: { win: { current, best }, daily: { current, best, lastDay, playedToday, atRisk } } }
 *   GET /quests       → { quests: { day, resetsAt, items: [...], sweep: { bonusXp, completedAt } } }
 *
 * @param {{
 *   gamificationComponent: ReturnType<typeof import("../../domain/gamification/gamificationComponent.js").createGamificationComponent>,
 *   now: () => number,
 * }} deps
 */
export function createGamificationRoutes({ gamificationComponent, now }) {
  assertDefined(gamificationComponent, "gamificationComponent");
  assertFunction(now, "now");
  const router = Router();

  router.get("/achievements", async (req, res) => {
    const { id } = requireIdentity(req.session);
    res.json({ achievements: await gamificationComponent.getAchievements({ playerId: id }) });
  });

  router.get("/streaks", async (req, res) => {
    const { id } = requireIdentity(req.session);
    res.json({ streaks: await gamificationComponent.getStreaks({ playerId: id, now: now() }) });
  });

  router.get("/quests", async (req, res) => {
    const { id } = requireIdentity(req.session);
    res.json({ quests: await gamificationComponent.getQuests({ playerId: id, now: now() }) });
  });

  return router;
}
