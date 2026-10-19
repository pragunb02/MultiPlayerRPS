// Writes the daily chess puzzle set from a downloaded Lichess puzzle CSV (CC-144, ADR-061).
//
// 1. Download the CC0 database, or its start, from https://database.lichess.org/#puzzles, into a new empty folder.
//    The start is enough: `curl -sS https://database.lichess.org/lichess_db_puzzle.csv.zst | zstd -dc | head -n 300001`
//    writes the header and 300,000 puzzles.
// 2. Run: node scripts/bin/curate-chess-puzzles.mjs --csv <that file> --out apps/server/src/persistence/puzzles/chessPuzzles.json
// 3. Run Prettier on the output and review the change. A new set changes which puzzle every future day gets.
import { readFileSync, writeFileSync } from "node:fs";
import { parseNamedArgs } from "../lib/args.mjs";
import { curateChessPuzzles, parsePuzzleCsv } from "../puzzles/curateChessPuzzles.mjs";

const { csv, out } = parseNamedArgs({ argv: process.argv.slice(2), names: ["csv", "out"] });
const puzzles = curateChessPuzzles(parsePuzzleCsv(readFileSync(csv, "utf8")));
const set = {
  source: "Lichess puzzle database, https://database.lichess.org/#puzzles",
  licence: "CC0-1.0",
  puzzles,
};
writeFileSync(out, `${JSON.stringify(set, null, 2)}\n`);
process.stdout.write(`Wrote ${puzzles.length} puzzles to ${out}\n`);
