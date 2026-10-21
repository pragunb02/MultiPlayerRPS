import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { requireIdentity } from "./session.js";

/**
 * The signed-in player's achievements, streaks and daily quests (CC-054, CC-089), and their time zone (CC-146).
 * Guests have them too.
 *
 *   GET /achievements → { achievements: [{ id, name, description, icon, tier, unlockedAt, progress: { current, target } }] }
 *   GET /streaks      → { streaks: { win: { current, best }, daily: { current, best, lastDay, playedToday, atRisk,
 *                       resetsAt?, freezes?: { held, max, covering, earnBackLeft }, nextMilestone? } } }
 *                       `resetsAt` with `local_days` on, `freezes` and `nextMilestone` with `streak_freezes` on
 *   GET /quests       → { quests: { day, resetsAt, items: [...], sweep: { bonusXp, completedAt } } }
 *   GET /time-zone    → { timeZone: { zone, chosen, changeableAt, dayEndsAt } }; 404 with `local_days` off
 *   PUT /time-zone { zone } → the same; 400 for a zone that is not one, 409 `zone-locked` with `changeableAt`
 *                       inside the 7 days. Never cached
 *
 * @param {{
 *   gamificationComponent: ReturnType<typeof import("../../domain/gamification/gamificationComponent.js").createGamificationComponent>,
 *   playerDaysComponent?: Pick<ReturnType<typeof import("../../domain/playerDays/playerDaysComponent.js").createPlayerDaysComponent>, "getTimeZone" | "setTimeZone">,
 *   now: () => number,
 * }} deps  without `playerDaysComponent` the time zone routes are not there
 */
export function createGamificationRoutes({ gamificationComponent, playerDaysComponent, now }) {
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

  if (playerDaysComponent !== undefined) {
    router.get("/time-zone", async (req, res) => {
      const { id } = requireIdentity(req.session);
      const timeZone = await playerDaysComponent.getTimeZone({ playerId: id, now: now() });
      res.setHeader("Cache-Control", "no-store");
      res.json({ timeZone });
    });

    router.put("/time-zone", async (req, res) => {
      const { id } = requireIdentity(req.session);
      const timeZone = await playerDaysComponent.setTimeZone({ playerId: id, zone: req.body?.zone, now: now() });
      res.setHeader("Cache-Control", "no-store");
      res.json({ timeZone });
    });
  }

  return router;
}
