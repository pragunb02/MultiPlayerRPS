import express from "express";
import helmet from "helmet";
import { assertDefined } from "../../utils/assert.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";
import { createRequestLogger } from "./requestLogger.js";
import { apiRouter } from "./routes.js";

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
 *   accountComponent: ReturnType<typeof import("../../domain/accounts/accountComponent.js").createAccountComponent>,
 *   authLimits?: Parameters<typeof import("./authRoutes.js").createAuthRoutes>[0]["limits"],
 *   onSessionEnded: (sessionId: string) => void,
 *   guestLimit?: { windowMs: number, limit: number },
 * }} deps
 */
export function createHttpApp({
  config,
  logger,
  sessionMiddleware,
  identityComponent,
  matchComponent,
  progressionComponent,
  accountComponent,
  authLimits,
  onSessionEnded,
  guestLimit,
}) {
  assertDefined(config, "config");
  assertDefined(logger, "logger");
  assertDefined(sessionMiddleware, "sessionMiddleware");

  const app = express();

  app.disable("x-powered-by");
  if (config.isProduction) {
    app.set("trust proxy", 1);
  }
  app.use(createRequestLogger({ logger }));
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", sessionMiddleware);

  app.use(
    "/api",
    apiRouter({
      identityComponent,
      matchComponent,
      progressionComponent,
      accountComponent,
      authLimits,
      onSessionEnded,
      guestLimit,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
