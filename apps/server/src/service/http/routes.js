import { Router } from "express";
import { GAMES } from "@classicade/shared";
import { createMatchRoutes } from "./matchRoutes.js";
import { createSessionRoutes } from "./sessionRoutes.js";

/**
 * @param {Parameters<typeof createSessionRoutes>[0] & Parameters<typeof createMatchRoutes>[0]} deps
 */
export function apiRouter({ matchComponent, ...sessionDeps }) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/games", (req, res) => {
    res.json({ games: GAMES });
  });

  router.use(createSessionRoutes(sessionDeps));
  router.use(createMatchRoutes({ matchComponent }));

  return router;
}
