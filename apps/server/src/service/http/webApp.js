import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { describePage } from "@classicade/shared";
import { createPageTemplate, renderPageHead, renderRobots, renderSitemap } from "./pageHead.js";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const ONE_HOUR_SECONDS = 60 * 60;
const NOT_APP_ROUTES = /^\/(api|socket\.io)(\/|$)/;
// What a missing build file is answered with, by its extension. Anything else gets plain text.
const MISSING_ASSET_TYPES = Object.freeze({
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
});
// The same words for every missing file. Repeating the requested path would let a crafted URL write script.
const MISSING_ASSET = "/* Not found: this file is not part of this version of the site. */\n";

/**
 * Serves the built web app (single deploy with the API, ADR-002):
 * - hashed files under /assets are cached for a year (their names change on every build);
 * - everything else, and especially index.html, is revalidated on every load so a deploy takes effect at once;
 * - any other GET that is not an API route returns index.html, so deep links like /room/AB2CD3 work.
 *
 * A file under /assets that is not there answers a plain 404 of its own type, never the app's HTML (CC-181).
 * That happens to an open tab after a deploy, when it asks for a file of the build it started with. The browser
 * then reports a failed load, which the web app answers by reloading once, instead of trying to run HTML as a
 * script. The answer is never cached, so a cache in front of the server cannot keep serving the 404.
 *
 * Each page's index.html carries that page's title, description and link preview tags (CC-047), because crawlers
 * and chat apps read the HTML without running the app. Its body carries the same title and description, so a
 * crawler that reads the body text does not take the loading screen for the page (CC-232). A URL where the app has
 * no page answers 404, still with the app, which then shows its own "not found" page.
 *
 * @param {{ distDir: string, siteOrigin: string }} options
 *   siteOrigin: the site's public address, for the absolute URLs in previews, the sitemap and robots.txt
 * @returns {import("express").Router}
 */
export function createWebAppRouter({ distDir, siteOrigin }) {
  const router = express.Router();
  const page = createPageTemplate(readFileSync(path.join(distDir, "index.html"), "utf8"));
  const robots = renderRobots({ origin: siteOrigin });
  const sitemap = renderSitemap({ origin: siteOrigin });

  router.get("/robots.txt", (req, res) => {
    res.setHeader("Cache-Control", `public, max-age=${ONE_HOUR_SECONDS}`);
    res.type("text/plain").send(robots);
  });
  router.get("/sitemap.xml", (req, res) => {
    res.setHeader("Cache-Control", `public, max-age=${ONE_HOUR_SECONDS}`);
    res.type("application/xml").send(sitemap);
  });

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

  router.use("/assets", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res
      .status(404)
      .type(MISSING_ASSET_TYPES[path.extname(req.path)] ?? "text/plain")
      .send(MISSING_ASSET);
  });

  router.get(/.*/, (req, res, next) => {
    if (NOT_APP_ROUTES.test(req.path) || !req.accepts("html")) {
      next();
      return;
    }
    const info = describePage(req.path);
    res.setHeader("Cache-Control", "no-cache");
    res
      .status(info.found ? 200 : 404)
      .type("html")
      .send(
        page({
          head: renderPageHead({ page: info, origin: siteOrigin }),
          title: info.title,
          description: info.description,
        }),
      );
  });

  return router;
}
