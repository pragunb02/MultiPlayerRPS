// Checks docs/CREDITS.md against the asset files in the web app (CC-230). Every picture, sound and font must have a
// row that says who made it and under which licence, so a licence problem is caught in review and not by a
// complaint after launch. The rules are explained in docs/art/README.md.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** File types that count as an asset. Each one needs a row in docs/CREDITS.md. */
export const ASSET_EXTENSIONS = Object.freeze([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "mp3",
  "wav",
  "ogg",
  "oga",
  "opus",
  "m4a",
  "aac",
  "flac",
  "woff",
  "woff2",
  "ttf",
  "otf",
]);

/**
 * Art drawn in code counts as an asset too: every component file in this folder needs a row, so Bit and whatever
 * replaces it are recorded like a file would be.
 */
export const ART_FOLDER = "apps/web/src/art/";

/**
 * Licences we accept, as SPDX ids. `LicenseRef-ClassiCade` is our own art, all rights reserved. ShareAlike,
 * NonCommercial and NoDerivatives licences are left out on purpose (see docs/tickets/CC-230.md).
 */
export const ALLOWED_LICENCES = Object.freeze([
  "LicenseRef-ClassiCade",
  "CC0-1.0",
  "CC-BY-4.0",
  "MIT",
  "BSD-3-Clause",
  "OFL-1.1",
]);

/** The largest SVG file we accept, in bytes. Bigger files usually mean an export full of editor data. */
export const MAX_SVG_BYTES = 20 * 1024;

// Folders that hold generated or installed files, never our assets.
const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "coverage", "test-results", "playwright-report"]);

const COLUMNS = Object.freeze(["file", "what", "author", "licence", "source", "added"]);
const ROW = /^\|\s*`([^`]+)`\s*\|/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a file needs a row in the credits.
 * @param {string} file Path relative to the repository root, with forward slashes.
 * @returns {boolean} True for asset files and for art components that are not tests.
 */
export function needsCredit(file) {
  const extension = path.posix.extname(file).slice(1).toLowerCase();
  if (ASSET_EXTENSIONS.includes(extension)) return true;
  return file.startsWith(ART_FOLDER) && extension === "jsx" && !file.endsWith(".test.jsx");
}

/**
 * Reads the credit rows out of the Markdown. A row is a table line whose first cell is a file path in backticks,
 * so headings, prose and the header row are skipped.
 * @param {string} markdown The text of docs/CREDITS.md.
 * @returns {ReadonlyArray<Readonly<Record<string, string>>>} One frozen record per row, keyed by column name.
 */
export function parseCredits(markdown) {
  return Object.freeze(
    markdown
      .split("\n")
      .filter((line) => ROW.test(line))
      .map((line) => {
        const cells = line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());
        const record = Object.fromEntries(COLUMNS.map((name, index) => [name, cells[index] ?? ""]));
        return Object.freeze({ ...record, file: ROW.exec(line)[1] });
      }),
  );
}

/**
 * Finds every file under a folder, skipping hidden, installed and generated folders.
 * @param {{ root: string, folder: string }} options The repository root, and the folder to search relative to it.
 * @returns {ReadonlyArray<string>} Paths relative to the root, with forward slashes, sorted.
 */
export function listFiles({ root, folder }) {
  const found = [];
  const visit = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_FOLDERS.has(entry.name)) visit(child);
      } else {
        found.push(child);
      }
    }
  };
  visit(folder);
  return Object.freeze(found.sort());
}

/**
 * The size of a file in bytes.
 * @param {{ root: string, file: string }} options The repository root, and the file relative to it.
 * @returns {number} The size in bytes.
 */
export const fileSize = ({ root, file }) => statSync(path.join(root, file)).size;

/**
 * Compares the credit rows with the files that exist and returns every problem in plain words.
 * @param {{ credits: ReadonlyArray<Readonly<Record<string, string>>>, files: ReadonlyArray<string>, sizeOf: (file: string) => number }} options
 *   The rows from `parseCredits`, every existing file that may be credited, and a way to read a file's size.
 * @returns {ReadonlyArray<string>} The problems, empty when the credits are complete and correct.
 */
export function creditProblems({ credits, files, sizeOf }) {
  const existing = new Set(files);
  const credited = new Set();
  const problems = [];
  for (const credit of credits) {
    if (credited.has(credit.file)) problems.push(`${credit.file} has more than one row`);
    credited.add(credit.file);
    if (!existing.has(credit.file)) problems.push(`${credit.file} is credited but does not exist`);
    if (!ALLOWED_LICENCES.includes(credit.licence)) {
      problems.push(`${credit.file} has licence "${credit.licence}", which is not on the allowed list`);
    }
    for (const column of ["what", "author", "source"]) {
      if (credit[column] === "") problems.push(`${credit.file} has no ${column}`);
    }
    if (!DATE.test(credit.added)) problems.push(`${credit.file} needs the date it was added as YYYY-MM-DD`);
  }
  for (const file of files) {
    if (needsCredit(file) && !credited.has(file)) problems.push(`${file} has no row in docs/CREDITS.md`);
    if (file.toLowerCase().endsWith(".svg") && sizeOf(file) > MAX_SVG_BYTES) {
      problems.push(`${file} is larger than ${MAX_SVG_BYTES / 1024} KB`);
    }
  }
  return Object.freeze(problems);
}
