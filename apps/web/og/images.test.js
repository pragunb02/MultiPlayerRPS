import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAMES, gamePreviewImage, PREVIEW_IMAGE, SITE_PREVIEW_IMAGE } from "@classicade/shared";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const PNG_SIGNATURE = "89504e470d0a1a0a";

/** Width and height from a PNG's header, which always starts at byte 16. */
function pngSize(file) {
  const bytes = readFileSync(path.join(publicDir, file));
  expect(bytes.subarray(0, 8).toString("hex"), `${file} is a PNG`).toBe(PNG_SIGNATURE);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// The server links these images from every page (CC-047). A new game without its image would preview as a broken
// picture, so this fails until `npm run og-images -w @classicade/web` has drawn it.
describe("link preview images", () => {
  it.each([SITE_PREVIEW_IMAGE, ...GAMES.map(gamePreviewImage)])("%s exists at the preview size", (file) => {
    expect(pngSize(file)).toEqual(PREVIEW_IMAGE);
  });
});
