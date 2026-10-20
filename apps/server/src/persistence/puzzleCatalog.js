import { readFileSync } from "node:fs";

const CHESS_PUZZLES = new URL("./puzzles/chessPuzzles.json", import.meta.url);

/**
 * @typedef {{ id: string, fen: string, moves: string[], rating: number, themes: string[] }} ChessPuzzleRecord
 */

/**
 * The daily chess puzzles we keep in the repository (CC-144, ADR-061), in the order the days use them. They come
 * from the Lichess puzzle database under CC0 (see puzzles/LICENSE.md). Read once, at boot.
 *
 * @param {{ file?: URL }} [options]  `file` is for tests only, to read a broken set
 * @returns {ChessPuzzleRecord[]}
 * @throws {Error} when the file is not a puzzle set
 */
export function loadChessPuzzles({ file = CHESS_PUZZLES } = {}) {
  const set = JSON.parse(readFileSync(file, "utf8"));
  if (set.licence !== "CC0-1.0" || !Array.isArray(set.puzzles)) {
    throw new Error(`${file.pathname} is not a CC0 puzzle set`);
  }
  return set.puzzles;
}
