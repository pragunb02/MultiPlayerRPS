import { Router } from "express";
import { GAMES } from "@classicade/shared";
import { createSessionRoutes } from "./sessionRoutes.js";

/**
 * @param {Parameters<typeof createSessionRoutes>[0]} sessionDeps
 */
export function apiRouter(sessionDeps) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/games", (req, res) => {
    res.json({ games: GAMES });
  });

  router.use(createSessionRoutes(sessionDeps));

  return router;
}
