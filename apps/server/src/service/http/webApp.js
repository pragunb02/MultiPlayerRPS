import path from "node:path";
import express from "express";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const NOT_APP_ROUTES = /^\/(api|socket\.io)(\/|$)/;

/**
 * Serves the built web app (single deploy with the API, ADR-002):
 * - hashed files under /assets are cached for a year (their names change on every build);
 * - everything else, and especially index.html, is revalidated on every load so a deploy takes effect at once;
 * - any other GET that is not an API route returns index.html, so deep links like /room/AB2CD3 work.
 *
 * @param {{ distDir: string }} options
 * @returns {import("express").Router}
 */
export function createWebAppRouter({ distDir }) {
  const router = express.Router();
  const indexFile = path.join(distDir, "index.html");

  router.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader(
          "Cache-Control",
          hashed ? `public, max-age=${ONE_YEAR_SECONDS}, immutable` : "no-cache",
        );
      },
    }),
  );

  router.get(/.*/, (req, res, next) => {
    if (NOT_APP_ROUTES.test(req.path) || !req.accepts("html")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  });

  return router;
}
