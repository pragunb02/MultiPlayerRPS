import { Router } from "express";
import { GAMES } from "@classicade/shared";
import { createAccountRoutes } from "./accountRoutes.js";
import { createAdminAccountRoutes } from "./adminAccountRoutes.js";
import { createAdminRoutes } from "./adminRoutes.js";
import { createAdminUxRoutes } from "./adminUxRoutes.js";
import { createAuthRoutes } from "./authRoutes.js";
import { createBlockRoutes } from "./blockRoutes.js";
import { createChallengeRoutes } from "./challengeRoutes.js";
import { createFeedbackRoutes } from "./feedbackRoutes.js";
import { createReportRoutes } from "./reportRoutes.js";
import { createFriendRoutes } from "./friendRoutes.js";
import { createFlagRoutes } from "./flagRoutes.js";
import { createDailyPuzzleRoutes } from "./dailyPuzzleRoutes.js";
import { createGamificationRoutes } from "./gamificationRoutes.js";
import { createLeaderboardRoutes } from "./leaderboardRoutes.js";
import { createMatchRoutes } from "./matchRoutes.js";
import { createProfileRoutes } from "./profileRoutes.js";
import { createProgressRoutes } from "./progressRoutes.js";
import { createSafetyRoutes } from "./safetyRoutes.js";
import { createSessionRoutes } from "./sessionRoutes.js";
import { createTelemetryRoutes } from "./telemetryRoutes.js";

/**
 * @param {Parameters<typeof createSessionRoutes>[0] & Parameters<typeof createMatchRoutes>[0] & Parameters<typeof createProgressRoutes>[0]
 *   & Parameters<typeof createGamificationRoutes>[0]
 *   & { leaderboardComponent: Parameters<typeof createLeaderboardRoutes>[0]["leaderboardComponent"], leaderboardLimit?: { windowMs: number, limit: number } }
 *   & { analyticsComponent: Parameters<typeof createAdminRoutes>[0]["analyticsComponent"], adminAccess: ReturnType<typeof import("./adminAccess.js").createAdminAccess> }
 *   & { uxReport?: Parameters<typeof createAdminUxRoutes>[0]["uxReport"] }
 *   & { playerDataComponent: Parameters<typeof createAccountRoutes>[0]["playerDataComponent"], onAccountDeleted: (playerId: string) => void, accountLimits?: Parameters<typeof createAccountRoutes>[0]["limits"] }
 *   & { blockComponent: Parameters<typeof createBlockRoutes>[0]["blockComponent"], blockLimits?: Parameters<typeof createBlockRoutes>[0]["limits"] }
 *   & { challengeComponent: Parameters<typeof createChallengeRoutes>[0]["challengeComponent"], challengeLimits?: Parameters<typeof createChallengeRoutes>[0]["limits"], networkOf: Parameters<typeof createChallengeRoutes>[0]["networkOf"] }
 *   & { profileComponent: Parameters<typeof createProfileRoutes>[0]["profileComponent"], profileLimits?: Parameters<typeof createProfileRoutes>[0]["limits"] }
 *   & { friendComponent: Parameters<typeof createFriendRoutes>[0]["friendComponent"], friendLimits?: Parameters<typeof createFriendRoutes>[0]["limits"] }
 *   & { feedbackComponent: Parameters<typeof createFeedbackRoutes>[0]["feedbackComponent"], feedbackLimits?: Parameters<typeof createFeedbackRoutes>[0]["limits"] }
 *   & { reportComponent: Parameters<typeof createReportRoutes>[0]["reportComponent"], reportLimits?: Parameters<typeof createReportRoutes>[0]["limits"] }
 *   & { flagComponent: Parameters<typeof createFlagRoutes>[0]["flagComponent"] }
 *   & { dailyPuzzleComponent: Parameters<typeof createDailyPuzzleRoutes>[0]["dailyPuzzleComponent"], dailyPuzzleLimit?: Parameters<typeof createDailyPuzzleRoutes>[0]["limit"] }
 *   & { safetyComponent: Parameters<typeof createSafetyRoutes>[0]["safetyComponent"] }
 *   & { telemetryComponent: Parameters<typeof createTelemetryRoutes>[0]["telemetryComponent"], serverEvents: ReturnType<typeof import("./telemetryRoutes.js").createServerEvents> }
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
  uxReport,
  adminAccess,
  playerDataComponent,
  onAccountDeleted,
  accountLimits,
  blockComponent,
  blockLimits,
  profileComponent,
  profileLimits,
  challengeComponent,
  challengeLimits,
  networkOf,
  friendComponent,
  friendLimits,
  feedbackComponent,
  feedbackLimits,
  reportComponent,
  reportLimits,
  dailyPuzzleComponent,
  dailyPuzzleLimit,
  safetyComponent,
  flagComponent,
  telemetryComponent,
  serverEvents,
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

  router.use(
    createSessionRoutes({ ...sessionDeps, onIdentityChanged, isAdmin: adminAccess.isAdmin, serverEvents }),
  );
  router.use(
    createAuthRoutes({
      accountComponent,
      onSessionEnded: sessionDeps.onSessionEnded,
      onOtherSessionsEnded,
      renewals,
      onIdentityChanged,
      serverEvents,
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
  router.use(
    createChallengeRoutes({
      challengeComponent,
      networkOf,
      now,
      ...(challengeLimits && { limits: challengeLimits }),
    }),
  );
  router.use(createFriendRoutes({ friendComponent, now, ...(friendLimits && { limits: friendLimits }) }));
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

  router.use(
    createReportRoutes({
      reportComponent,
      requireAdmin: adminAccess.requireAdmin,
      now,
      ...(reportLimits && { limits: reportLimits }),
    }),
  );

  router.use(createFlagRoutes({ flagComponent, adminAccess }));
  router.use(createTelemetryRoutes({ telemetryComponent, flagComponent, adminAccess, now }));

  router.use(createAdminRoutes({ analyticsComponent, requireAdmin: adminAccess.requireAdmin, now }));
  // The owner's UX page (CC-177). A test app made without it answers the ordinary 404 there.
  if (uxReport !== undefined) {
    router.use(createAdminUxRoutes({ uxReport, adminAccess, flagComponent, now }));
  }
  router.use(createAdminAccountRoutes({ accountComponent, requireAdmin: adminAccess.requireAdmin, now }));

  return router;
}
