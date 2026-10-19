// Draws the link preview images in apps/web/public/og from the app's own art (CC-047). Run it after changing the
// art or adding a game, and commit the images and the list it writes: npm run og-images -w @classicade/web
//
// The cards are React components rendered by Vite in a real browser (Playwright's Chromium, which the browser
// tests already install), so the images match the site exactly and need no image library.
//
// The images are JPEGs under 150 KB, because WhatsApp skips or shrinks large preview images (CC-217). Each file
// name carries the first characters of a hash of the image, so a changed image gets a new address: chat apps
// keep a preview image by its address, and an old address would keep showing the old picture. Files from earlier
// runs are never deleted, because messages sent before still point at them.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { GAMES, PREVIEW_IMAGE, PREVIEW_IMAGE_HASH_LENGTH } from "@classicade/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const ogDir = path.join(here, "..", "public", "og");
const listFile = path.join(here, "..", "..", "..", "packages", "shared", "src", "previewImages.js");

// Chosen so every card lands between about 55 and 90 KB at 1200 by 630, with no visible blocks around the text.
const JPEG_QUALITY = 90;

const cards = ["classicade", ...GAMES.map((game) => game.slug)];

/** The list of image files that packages/shared reads, as a small module so no JSON import is needed. */
function listModule(files) {
  // Quotes only where a name needs them, as the formatter writes it.
  const key = (card) => (/^[a-z]\w*$/.test(card) ? card : JSON.stringify(card));
  const entries = Object.entries(files).map(([card, file]) => `  ${key(card)}: "${file}",`);
  return [
    "// Written by apps/web/og/render.mjs (CC-217). Do not change it by hand: run the script again.",
    "",
    "/** The link preview image of each card, by card name: the game's slug, or `classicade` for the site. */",
    "export const PREVIEW_IMAGE_FILES = Object.freeze({",
    ...entries,
    "});",
    "",
  ].join("\n");
}

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
  mkdirSync(ogDir, { recursive: true });
  const files = {};
  for (const card of cards) {
    await page.goto(`${address}?card=${encodeURIComponent(card)}`);
    await page.locator("body[data-ready]").waitFor();
    const image = await page.screenshot({
      type: "jpeg",
      quality: JPEG_QUALITY,
      clip: { x: 0, y: 0, ...PREVIEW_IMAGE },
    });
    const hash = createHash("sha256").update(image).digest("hex").slice(0, PREVIEW_IMAGE_HASH_LENGTH);
    const name = `${card}.${hash}.jpg`;
    writeFileSync(path.join(ogDir, name), image);
    files[card] = `/og/${name}`;
    process.stdout.write(`wrote public/og/${name} (${image.length} bytes)\n`);
  }
  writeFileSync(listFile, listModule(files));
  process.stdout.write(`wrote ${path.relative(process.cwd(), listFile)}\n`);
} finally {
  await browser.close();
  await server.close();
}
