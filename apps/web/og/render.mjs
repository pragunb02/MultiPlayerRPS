// Draws the link preview images in apps/web/public/og from the app's own art (CC-047). Run it after changing the
// art or adding a game, and commit the images: npm run og-images -w @classicade/web
//
// The cards are React components rendered by Vite in a real browser (Playwright's Chromium, which the browser
// tests already install), so the PNGs match the site exactly and need no image library.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { GAMES, PREVIEW_IMAGE, SITE_PREVIEW_IMAGE, gamePreviewImage } from "@classicade/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

const cards = [
  { card: "classicade", file: SITE_PREVIEW_IMAGE },
  ...GAMES.map((game) => ({ card: game.slug, file: gamePreviewImage(game) })),
];

const server = await createServer({
  root: here,
  configFile: false,
  plugins: [react()],
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const address = server.resolvedUrls.local[0];
const browser = await chromium.launch();
try {
  // Light colours and no motion: the art's entrance animations would otherwise be caught half way.
  const page = await browser.newPage({
    viewport: PREVIEW_IMAGE,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  for (const { card, file } of cards) {
    const target = path.join(publicDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    await page.goto(`${address}?card=${encodeURIComponent(card)}`);
    await page.locator("body[data-ready]").waitFor();
    await page.screenshot({ path: target, clip: { x: 0, y: 0, ...PREVIEW_IMAGE } });
    process.stdout.write(`wrote ${path.relative(process.cwd(), target)}\n`);
  }
} finally {
  await browser.close();
  await server.close();
}
