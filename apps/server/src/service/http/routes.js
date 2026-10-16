import { Router } from "express";
import { GAMES } from "@classicade/shared";
import { createAuthRoutes } from "./authRoutes.js";
import { createMatchRoutes } from "./matchRoutes.js";
import { createProgressRoutes } from "./progressRoutes.js";
import { createSessionRoutes } from "./sessionRoutes.js";

/**
 * @param {Parameters<typeof createSessionRoutes>[0] & Parameters<typeof createMatchRoutes>[0] & Parameters<typeof createProgressRoutes>[0]} deps
 */
export function apiRouter({
  matchComponent,
  progressionComponent,
  accountComponent,
  authLimits,
  onIdentityChanged,
  ...sessionDeps
}) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/games", (req, res) => {
    res.json({ games: GAMES });
  });

  router.use(createSessionRoutes({ ...sessionDeps, onIdentityChanged }));
  router.use(
    createAuthRoutes({
      accountComponent,
      onSessionEnded: sessionDeps.onSessionEnded,
      onIdentityChanged,
      ...(authLimits && { limits: authLimits }),
    }),
  );
  router.use(createMatchRoutes({ matchComponent }));
  router.use(createProgressRoutes({ progressionComponent }));

  return router;
}
