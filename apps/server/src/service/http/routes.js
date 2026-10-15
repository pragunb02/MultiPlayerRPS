import { Router } from "express";
import { GAMES } from "@classicade/shared";

export function apiRouter() {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/games", (req, res) => {
    res.json({ games: GAMES });
  });

  return router;
}
