import { Router } from "express";
import { GAMES } from "@classicade/shared";
import { createAccountRoutes } from "./accountRoutes.js";
import { createAdminAccountRoutes } from "./adminAccountRoutes.js";
import { createAdminRoutes } from "./adminRoutes.js";
import { createAuthRoutes } from "./authRoutes.js";
import { createBlockRoutes } from "./blockRoutes.js";
import { createFeedbackRoutes } from "./feedbackRoutes.js";
import { createFlagRoutes } from "./flagRoutes.js";
import { createDailyPuzzleRoutes } from "./dailyPuzzleRoutes.js";
import { createGamificationRoutes } from "./gamificationRoutes.js";
import { createLeaderboardRoutes } from "./leaderboardRoutes.js";
import { createMatchRoutes } from "./matchRoutes.js";
import { createProfileRoutes } from "./profileRoutes.js";
import { createProgressRoutes } from "./progressRoutes.js";
import { createSafetyRoutes } from "./safetyRoutes.js";
import { createSessionRoutes } from "./sessionRoutes.js";

/**
 * @param {Parameters<typeof createSessionRoutes>[0] & Parameters<typeof createMatchRoutes>[0] & Parameters<typeof createProgressRoutes>[0]
 *   & Parameters<typeof createGamificationRoutes>[0]
 *   & { leaderboardComponent: Parameters<typeof createLeaderboardRoutes>[0]["leaderboardComponent"], leaderboardLimit?: { windowMs: number, limit: number } }
 *   & { analyticsComponent: Parameters<typeof createAdminRoutes>[0]["analyticsComponent"], adminAccess: ReturnType<typeof import("./adminAccess.js").createAdminAccess> }
 *   & { playerDataComponent: Parameters<typeof createAccountRoutes>[0]["playerDataComponent"], onAccountDeleted: (playerId: string) => void, accountLimits?: Parameters<typeof createAccountRoutes>[0]["limits"] }
 *   & { blockComponent: Parameters<typeof createBlockRoutes>[0]["blockComponent"], blockLimits?: Parameters<typeof createBlockRoutes>[0]["limits"] }
 *   & { profileComponent: Parameters<typeof createProfileRoutes>[0]["profileComponent"], profileLimits?: Parameters<typeof createProfileRoutes>[0]["limits"] }
 *   & { feedbackComponent: Parameters<typeof createFeedbackRoutes>[0]["feedbackComponent"], feedbackLimits?: Parameters<typeof createFeedbackRoutes>[0]["limits"] }
 *   & { flagComponent: Parameters<typeof createFlagRoutes>[0]["flagComponent"] }
 *   & { dailyPuzzleComponent: Parameters<typeof createDailyPuzzleRoutes>[0]["dailyPuzzleComponent"], dailyPuzzleLimit?: Parameters<typeof createDailyPuzzleRoutes>[0]["limit"] }
 *   & { safetyComponent: Parameters<typeof createSafetyRoutes>[0]["safetyComponent"] }
 *   & { build: Readonly<import("../../config/build.js").BuildSettings> }} deps  `build` is shown on the health check (CC-303)
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
  profileComponent,
  profileLimits,
  feedbackComponent,
  feedbackLimits,
  dailyPuzzleComponent,
  dailyPuzzleLimit,
  safetyComponent,
  flagComponent,
  build,
  ...sessionDeps
}) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", commit: build.commit, version: build.version });
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
  router.use(createMatchRoutes({ matchComponent, now }));
  router.use(createBlockRoutes({ blockComponent, now, ...(blockLimits && { limits: blockLimits }) }));
  router.use(createProfileRoutes({ profileComponent, now, ...(profileLimits && { limits: profileLimits }) }));
  router.use(createSafetyRoutes({ safetyComponent, now }));
  router.use(createProgressRoutes({ progressionComponent }));
  router.use(createGamificationRoutes({ gamificationComponent, now }));
  router.use(
    createDailyPuzzleRoutes({
      dailyPuzzleComponent,
      now,
      ...(dailyPuzzleLimit && { limit: dailyPuzzleLimit }),
    }),
  );
  router.use(
    createLeaderboardRoutes({
      leaderboardComponent,
      now,
      ...(leaderboardLimit && { limit: leaderboardLimit }),
    }),
  );

  router.use(
    createFeedbackRoutes({
      feedbackComponent,
      requireAdmin: adminAccess.requireAdmin,
      now,
      ...(feedbackLimits && { limits: feedbackLimits }),
    }),
  );

  router.use(createFlagRoutes({ flagComponent, adminAccess }));

  router.use(createAdminRoutes({ analyticsComponent, requireAdmin: adminAccess.requireAdmin, now }));
  router.use(createAdminAccountRoutes({ accountComponent, requireAdmin: adminAccess.requireAdmin, now }));

  return router;
}
