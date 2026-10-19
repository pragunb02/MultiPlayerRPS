import { Router } from "express";
import { GAMES } from "@classicade/shared";
import { createAccountRoutes } from "./accountRoutes.js";
import { createAdminRoutes } from "./adminRoutes.js";
import { createAuthRoutes } from "./authRoutes.js";
import { createBlockRoutes } from "./blockRoutes.js";
import { createGamificationRoutes } from "./gamificationRoutes.js";
import { createLeaderboardRoutes } from "./leaderboardRoutes.js";
import { createMatchRoutes } from "./matchRoutes.js";
import { createProgressRoutes } from "./progressRoutes.js";
import { createSessionRoutes } from "./sessionRoutes.js";

/**
 * @param {Parameters<typeof createSessionRoutes>[0] & Parameters<typeof createMatchRoutes>[0] & Parameters<typeof createProgressRoutes>[0]
 *   & Parameters<typeof createGamificationRoutes>[0]
 *   & { leaderboardComponent: Parameters<typeof createLeaderboardRoutes>[0]["leaderboardComponent"], leaderboardLimit?: { windowMs: number, limit: number } }
 *   & { analyticsComponent: Parameters<typeof createAdminRoutes>[0]["analyticsComponent"], adminAccess: ReturnType<typeof import("./adminAccess.js").createAdminAccess> }
 *   & { playerDataComponent: Parameters<typeof createAccountRoutes>[0]["playerDataComponent"], onAccountDeleted: (playerId: string) => void, accountLimits?: Parameters<typeof createAccountRoutes>[0]["limits"] }
 *   & { blockComponent: Parameters<typeof createBlockRoutes>[0]["blockComponent"], blockLimits?: Parameters<typeof createBlockRoutes>[0]["limits"] }} deps
 */
export function apiRouter({
  matchComponent,
  progressionComponent,
  gamificationComponent,
  leaderboardComponent,
  leaderboardLimit,
  accountComponent,
  authLimits,
  onIdentityChanged,
  onOtherSessionsEnded,
  renewals,
  now,
  analyticsComponent,
  adminAccess,
  playerDataComponent,
  onAccountDeleted,
  accountLimits,
  blockComponent,
  blockLimits,
  ...sessionDeps
}) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/games", (req, res) => {
    res.json({ games: GAMES });
  });

  router.use(createSessionRoutes({ ...sessionDeps, onIdentityChanged, isAdmin: adminAccess.isAdmin }));
  router.use(
    createAuthRoutes({
      accountComponent,
      onSessionEnded: sessionDeps.onSessionEnded,
      onOtherSessionsEnded,
      renewals,
      onIdentityChanged,
      now,
      ...(authLimits && { limits: authLimits }),
    }),
  );
  router.use(
    createAccountRoutes({
      accountComponent,
      playerDataComponent,
      onSessionEnded: sessionDeps.onSessionEnded,
      onAccountDeleted,
      now,
      ...(accountLimits && { limits: accountLimits }),
    }),
  );
  router.use(createMatchRoutes({ matchComponent }));
  router.use(createBlockRoutes({ blockComponent, now, ...(blockLimits && { limits: blockLimits }) }));
  router.use(createProgressRoutes({ progressionComponent }));
  router.use(createGamificationRoutes({ gamificationComponent, now }));
  router.use(
    createLeaderboardRoutes({
      leaderboardComponent,
      now,
      ...(leaderboardLimit && { limit: leaderboardLimit }),
    }),
  );

  router.use(createAdminRoutes({ analyticsComponent, requireAdmin: adminAccess.requireAdmin, now }));

  return router;
}
