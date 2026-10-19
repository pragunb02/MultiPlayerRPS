import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GAMES,
  gamePreviewImage,
  PREVIEW_IMAGE,
  PREVIEW_IMAGE_HASH_LENGTH,
  RETIRED_PREVIEW_IMAGES,
  SITE_PREVIEW_IMAGE,
} from "@classicade/shared";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const PNG_SIGNATURE = "89504e470d0a1a0a";
const JPEG_START = "ffd8ff";
// WhatsApp's own limit is 600 KB. Larger images are often skipped or shown as a small thumbnail, so 300 KB is the
// hard limit here and 150 KB the target (CC-217).
const HARD_LIMIT_BYTES = 300 * 1024;
const TARGET_BYTES = 150 * 1024;
// Start of frame markers of a JPEG, the segments that carry its width and height (baseline, extended, progressive).
const START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2]);

const read = (file) => readFileSync(path.join(publicDir, file));

/** Width and height from a PNG's header, which always starts at byte 16. */
function pngSize(bytes) {
  expect(bytes.subarray(0, 8).toString("hex"), "a PNG").toBe(PNG_SIGNATURE);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Width and height from a JPEG, read from its start of frame segment. */
function jpegSize(bytes) {
  expect(bytes.subarray(0, 3).toString("hex"), "a JPEG").toBe(JPEG_START);
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1];
    if (START_OF_FRAME.has(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error("The JPEG has no start of frame segment");
}

const CURRENT = [SITE_PREVIEW_IMAGE, ...GAMES.map(gamePreviewImage)];

// The server links these images from every page (CC-047). A new game without its image would preview as a broken
// picture, so this fails until `npm run og-images -w @classicade/web` has drawn it.
describe("link preview images", () => {
  it("has an image for the site and for every game", () => {
    expect(CURRENT.every((file) => typeof file === "string")).toBe(true);
    expect(new Set(CURRENT).size).toBe(GAMES.length + 1);
  });

  it.each(CURRENT)("%s is a JPEG at the preview size", (file) => {
    expect(file).toMatch(/\.jpg$/);
    expect(jpegSize(read(file))).toEqual(PREVIEW_IMAGE);
  });

  it.each(CURRENT)("%s is under 150 KB, well inside the 300 KB limit", (file) => {
    const { length } = read(file);

    expect(length).toBeLessThan(HARD_LIMIT_BYTES);
    expect(length).toBeLessThan(TARGET_BYTES);
  });

  it.each(CURRENT)(
    "%s carries the start of its own hash in its name, so a new image gets a new address",
    (file) => {
      const hash = createHash("sha256").update(read(file)).digest("hex").slice(0, PREVIEW_IMAGE_HASH_LENGTH);

      expect(path.basename(file)).toMatch(new RegExp(`\\.${hash}\\.jpg$`));
    },
  );

  it.each(RETIRED_PREVIEW_IMAGES)("keeps the retired %s online for messages sent before", (file) => {
    expect(pngSize(read(file))).toEqual(PREVIEW_IMAGE);
    expect(CURRENT).not.toContain(file);
  });
});
