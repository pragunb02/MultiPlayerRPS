import express from "express";
import helmet from "helmet";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";
import { createApiRateLimit, DEFAULT_API_LIMIT } from "./rateLimits.js";
import { createCsrfGuard, contentSecurityPolicy } from "./requestGuards.js";
import { createAdminAccess } from "./adminAccess.js";
import { createRequestLogger } from "./requestLogger.js";
import { apiRouter } from "./routes.js";
import { createSessionGuard, createSessionRenewals } from "./session.js";
import { createWebAppRouter } from "./webApp.js";

/**
 * Service layer entry point for HTTP: creates the Express app without binding a port,
 * so tests can drive it in-process.
 *
 * @param {{
 *   config: Readonly<import("../../config/index.js").Config>,
 *   logger: import("../../utils/logger.js").Logger,
 *   sessionMiddleware: import("express").RequestHandler,
 *   identityComponent: ReturnType<typeof import("../../domain/identity/identityComponent.js").createIdentityComponent>,
 *   matchComponent: ReturnType<typeof import("../../domain/matches/matchComponent.js").createMatchComponent>,
 *   progressionComponent: ReturnType<typeof import("../../domain/progression/progressionComponent.js").createProgressionComponent>,
 *   gamificationComponent: ReturnType<typeof import("../../domain/gamification/gamificationComponent.js").createGamificationComponent>,
 *   accountComponent: ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>,
 *   playerDataComponent: ReturnType<typeof import("../../domain/accounts/playerDataComponent.js").createPlayerDataComponent>,
 *   onAccountDeleted: (playerId: string) => void,  told once an account is deleted, so its sockets are cut (CC-035)
 *   accountLimits?: Parameters<typeof import("./accountRoutes.js").createAccountRoutes>[0]["limits"],
 *   authLimits?: Parameters<typeof import("./authRoutes.js").createAuthRoutes>[0]["limits"],
 *   onSessionEnded: (sessionId: string) => void,
 *   onOtherSessionsEnded: (which: { playerId: string, fromSessionId: string, toSessionId: string }) => void,  told
 *     when one session ended every other session of its account and took a new id (CC-116)
 *   checkSession: ReturnType<typeof import("./session.js").createSessionCheck>,  whether a session may still be used
 *   onIdentityChanged: Parameters<typeof import("./authRoutes.js").createAuthRoutes>[0]["onIdentityChanged"],
 *   guestLimit?: { windowMs: number, limit: number },
 *   leaderboardComponent: ReturnType<typeof import("../../domain/leaderboards/leaderboardComponent.js").createLeaderboardComponent>,
 *   leaderboardLimit?: { windowMs: number, limit: number },
 *   apiLimit?: { windowMs: number, limit: number },   the budget for all of /api together, per session or address
 *   analyticsComponent: ReturnType<typeof import("../../domain/analytics/analyticsComponent.js").createAnalyticsComponent>,
 *   isDatabaseUp: () => boolean,
 *   now?: () => number,   the clock for date-dependent answers (daily quests); tests pick a day
 * }} deps
 */
export function createHttpApp({
  config,
  logger,
  sessionMiddleware,
  identityComponent,
  matchComponent,
  progressionComponent,
  gamificationComponent,
  accountComponent,
  playerDataComponent,
  onAccountDeleted,
  accountLimits,
  authLimits,
  onSessionEnded,
  onOtherSessionsEnded,
  checkSession,
  onIdentityChanged,
  guestLimit,
  leaderboardComponent,
  leaderboardLimit,
  analyticsComponent,
  apiLimit = DEFAULT_API_LIMIT,
  isDatabaseUp,
  now = Date.now,
}) {
  assertDefined(config, "config");
  assertFunction(isDatabaseUp, "isDatabaseUp");
  assertDefined(logger, "logger");
  assertDefined(sessionMiddleware, "sessionMiddleware");

  const app = express();
  const adminAccess = createAdminAccess({ adminAccountIds: config.adminAccountIds });

  app.disable("x-powered-by");
  // Rate limits key on req.ip, and Express finds it by counting this many proxies in from the right of
  // X-Forwarded-For. Zero means the header is ignored. The number comes from TRUST_PROXY_HOPS (see DEPLOYMENT.md).
  app.set("trust proxy", config.trustProxyHops === 0 ? false : config.trustProxyHops);
  logger.info({ trustProxyHops: config.trustProxyHops }, "client addresses read through trusted proxies");
  app.use(createRequestLogger({ logger }));
  app.use(
    helmet({
      contentSecurityPolicy: contentSecurityPolicy({ isProduction: config.isProduction }),
      frameguard: { action: "deny" }, // matches frame-ancestors 'none' for older browsers
    }),
  );
  // For the hosting platform (Render "Health Check Path"): 503 while the database is down, so a broken deploy is
  // never promoted to live. Outside /api: no session, no CSRF guard.
  app.get("/health", (req, res) => {
    const up = isDatabaseUp();
    res.status(up ? 200 : 503).json({ status: up ? "ok" : "unavailable", database: up ? "up" : "down" });
  });

  app.use(express.json({ limit: "100kb" }));
  app.use("/api", createCsrfGuard({ allowedOrigins: config.allowedOrigins }));
  app.use("/api", sessionMiddleware);
  // After the session, so a signed-in or guest player is counted by session rather than by address.
  app.use("/api", createApiRateLimit(apiLimit));
  // After the limit, so a flood of requests is refused before it costs a database read each. A session signed out
  // elsewhere or older than 90 days goes on as no session at all (CC-116).
  const renewals = createSessionRenewals({ now });
  app.use("/api", createSessionGuard({ checkSession, onSessionEnded, renewals, now }));

  app.use(
    "/api",
    apiRouter({
      identityComponent,
      matchComponent,
      progressionComponent,
      gamificationComponent,
      accountComponent,
      authLimits,
      onSessionEnded,
      onOtherSessionsEnded,
      renewals,
      onIdentityChanged,
      guestLimit,
      now,
      leaderboardComponent,
      leaderboardLimit,
      analyticsComponent,
      adminAccess,
      playerDataComponent,
      onAccountDeleted,
      accountLimits,
    }),
  );

  if (config.webDistDir !== "") {
    // The first allowed origin is the site's own public address (docs/DEPLOYMENT.md).
    app.use(
      createWebAppRouter({
        distDir: config.webDistDir,
        siteOrigin: config.allowedOrigins[0],
        adminPage: { sessionMiddleware, isAdmin: adminAccess.isAdmin },
      }),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
