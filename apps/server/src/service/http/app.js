import express from "express";
import helmet from "helmet";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";
import { createCsrfGuard, contentSecurityPolicy } from "./requestGuards.js";
import { createRequestLogger } from "./requestLogger.js";
import { apiRouter } from "./routes.js";
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
 *   authLimits?: Parameters<typeof import("./authRoutes.js").createAuthRoutes>[0]["limits"],
 *   onSessionEnded: (sessionId: string) => void,
 *   onIdentityChanged: Parameters<typeof import("./authRoutes.js").createAuthRoutes>[0]["onIdentityChanged"],
 *   guestLimit?: { windowMs: number, limit: number },
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
  authLimits,
  onSessionEnded,
  onIdentityChanged,
  guestLimit,
  isDatabaseUp,
  now = Date.now,
}) {
  assertDefined(config, "config");
  assertFunction(isDatabaseUp, "isDatabaseUp");
  assertDefined(logger, "logger");
  assertDefined(sessionMiddleware, "sessionMiddleware");

  const app = express();

  app.disable("x-powered-by");
  if (config.isProduction) {
    app.set("trust proxy", 1);
  }
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
      onIdentityChanged,
      guestLimit,
      now,
    }),
  );

  if (config.webDistDir !== "") {
    app.use(createWebAppRouter({ distDir: config.webDistDir }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
