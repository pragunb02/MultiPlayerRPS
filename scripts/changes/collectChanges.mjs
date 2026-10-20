// Changelog fragments (CC-299, ADR-068). Each pull request adds one file, docs/changes/CC-###.md, instead of
// editing the changelog in docs/PROGRESS.md and its row on the board in docs/BACKLOG.md, which every parallel pull
// request used to edit at the same place. The coordinator later runs scripts/bin/collect-changes.mjs, which folds
// the fragments into both files with the functions below and deletes them. The format is in docs/changes/README.md.
import { parse } from "yaml";

import { OpsError } from "../lib/errors.mjs";

/** The folder the fragments live in, from the repository root. */
export const CHANGES_FOLDER = "docs/changes";

/** The board's ticket types (BACKLOG.md, the Type field). */
export const TYPES = Object.freeze(["feature", "bug", "security", "debt", "infra", "test", "docs", "chore"]);

/** The board status a fragment may set, and the text of the Status cell for each. */
export const STATUSES = Object.freeze({
  todo: "⬜ Todo",
  "in-progress": "🟦 In progress",
  blocked: "⛔ Blocked",
  done: "✅ Done",
});

const KEYS = Object.freeze(["ticket", "date", "type", "status", "adrs", "pr"]);
const FRAGMENT_NAME = /^CC-\d{3,}\.md$/;
const ADR = /^ADR-\d{3}( \(amended\))?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const MERGE_SUBJECT = /^Merge pull request #(\d+) /;
const PR_PREFIX = /^\(#\d+\) /;
const CHANGELOG_HEADING = "## Changelog";

/**
 * @typedef {object} Fragment
 * @property {string} ticket The ticket ID, the same as the file name.
 * @property {string} date The day of the change, `YYYY-MM-DD`.
 * @property {string} type One of TYPES.
 * @property {keyof typeof STATUSES} status The ticket's board status after the change.
 * @property {readonly string[]} adrs The decisions the change made or amended.
 * @property {number} [pr] The pull request number, when the builder or git knows it.
 * @property {string} text The changelog text, on one line.
 * @property {string} row A full board row for the ticket, or an empty string for none.
 */

// A git ref such as `HEAD^1` or `origin/main`. It may not start with a hyphen, so git never reads it as an option.
const REF = /^(?!-)[\w./~^-]+$/;

/**
 * Reads the command line of scripts/bin/collect-changes.mjs: nothing to fold, `--check` to check only, and
 * `--base REF` with `--check` to also check the changelog against that ref.
 *
 * @param {readonly string[]} argv The arguments after the script name.
 * @returns {Readonly<{ check: boolean, base: string }>} `base` is empty when not given.
 * @throws {OpsError} On anything else.
 */
export function parseOptions(argv) {
  let check = false;
  let base = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check" && !check) {
      check = true;
    } else if (argv[index] === "--base" && base === "" && REF.test(argv[index + 1] ?? "")) {
      base = argv[index + 1];
      index += 1;
    } else {
      throw new OpsError(`Unexpected ${argv[index]}. Expected: --check, optionally --base REF`);
    }
  }
  if (base !== "" && !check) throw new OpsError("--base works only with --check");
  return Object.freeze({ check, base });
}

/** Whether a file in docs/changes is a fragment. Only `CC-###.md` names are, so the ticket ID is the key. */
export const isFragmentName = (/** @type {string} */ name) => FRAGMENT_NAME.test(name);

/** Whether a string is a real calendar day in `YYYY-MM-DD` form. A day such as 2026-02-30 moves to March. */
const isDay = (/** @type {unknown} */ value) => {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
};

/** The cells of a Markdown table row. A pipe written as `\|` stays inside its cell. */
const cellsOf = (/** @type {string} */ line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/** A Markdown table row from its cells. Prettier pads the columns again when the script writes the file. */
const rowFrom = (/** @type {readonly string[]} */ cells) => `| ${cells.join(" | ")} |`;

/** The ticket ID in a board row's first cell, plain or as a link to its ticket file. */
const ticketOf = (/** @type {string} */ cell) => cell.replace(/^\[(CC-\d+)\]\([^)]*\)$/, "$1");

/**
 * Reads one fragment and checks every field, so a mistake is caught in the pull request that made it.
 *
 * @param {{ name: string, text: string }} params The file name and its content.
 * @returns {Readonly<Fragment>}
 * @throws {OpsError} Naming the file and every problem found in it.
 */
export function parseFragment({ name, text }) {
  if (!isFragmentName(name)) {
    throw new OpsError(`${CHANGES_FOLDER}/${name}: a fragment is named after its ticket, CC-###.md`);
  }
  const ticket = name.replace(/\.md$/, "");
  const fail = (/** @type {string[]} */ problems) => {
    throw new OpsError(`${CHANGES_FOLDER}/${name}: ${problems.join("; ")}`);
  };
  const parts = FRONT_MATTER.exec(text.replace(/\r\n/g, "\n"));
  if (!parts) fail(["it must start with front matter between two --- lines"]);
  const [, frontText, body] = /** @type {RegExpExecArray} */ (parts);
  /** @type {unknown} */
  let front;
  try {
    front = parse(frontText);
  } catch (error) {
    fail([`the front matter is not YAML (${/** @type {Error} */ (error).message.split("\n")[0]})`]);
  }
  if (typeof front !== "object" || front === null || Array.isArray(front)) {
    fail(["the front matter must be keys and values"]);
  }
  const fields = /** @type {Record<string, unknown>} */ (front);
  const problems = Object.keys(fields)
    .filter((key) => !KEYS.includes(key))
    .map((key) => `unknown key ${key}`);
  if (fields.ticket !== ticket) problems.push(`ticket must be ${ticket}, the file name`);
  if (!isDay(fields.date)) problems.push("date must be a day written YYYY-MM-DD");
  if (!TYPES.includes(/** @type {string} */ (fields.type)))
    problems.push(`type must be one of ${TYPES.join(", ")}`);
  if (!Object.hasOwn(STATUSES, /** @type {string} */ (fields.status))) {
    problems.push(`status must be one of ${Object.keys(STATUSES).join(", ")}`);
  }
  const adrs = fields.adrs;
  if (!Array.isArray(adrs) || !adrs.every((adr) => typeof adr === "string" && ADR.test(adr))) {
    problems.push("adrs must be a list such as [] or [ADR-068, ADR-055 (amended)]");
  }
  if (fields.pr !== undefined && !(Number.isInteger(fields.pr) && /** @type {number} */ (fields.pr) > 0)) {
    problems.push("pr must be the pull request number");
  }
  const lines = body.split("\n").map((line) => line.trim());
  const rows = lines.filter((line) => line.startsWith("|"));
  const textLine = lines.filter((line) => line !== "" && !line.startsWith("|")).join(" ");
  if (textLine === "") problems.push("the changelog text below the front matter is empty");
  if (rows.length > 1) problems.push("give at most one board row");
  if (rows.length === 1 && ticketOf(cellsOf(rows[0])[0]) !== ticket) {
    problems.push(`the board row must start with ${ticket}`);
  }
  if (problems.length > 0) fail(problems);
  return Object.freeze({
    ticket,
    date: /** @type {string} */ (fields.date),
    type: /** @type {string} */ (fields.type),
    status: /** @type {keyof typeof STATUSES} */ (fields.status),
    adrs: Object.freeze([.../** @type {string[]} */ (adrs)]),
    ...(fields.pr === undefined ? {} : { pr: /** @type {number} */ (fields.pr) }),
    text: textLine,
    row: rows[0] ?? "",
  });
}

/** The start of a fragment's changelog line, up to its text. */
const linePrefix = (/** @type {Fragment} */ fragment) =>
  `- ${fragment.date} — ${[fragment.ticket, ...fragment.adrs].join(", ")} — `;

/**
 * The fragment's changelog line in the format PROGRESS.md has always used: the day, the ticket and its ADRs, then
 * the pull request in brackets when it is known, then the text.
 *
 * @param {Fragment} fragment
 * @returns {string}
 */
export const renderLine = (fragment) =>
  `${linePrefix(fragment)}${fragment.pr === undefined ? "" : `(#${fragment.pr}) `}${fragment.text}`;

/**
 * Whether a changelog entry is this fragment's line. The pull request number is allowed to differ or be missing,
 * because it is filled from git only after the merge.
 */
const isLineOf = (/** @type {string} */ entry, /** @type {Fragment} */ fragment) => {
  const prefix = linePrefix(fragment);
  return entry.startsWith(prefix) && entry.slice(prefix.length).replace(PR_PREFIX, "") === fragment.text;
};

/**
 * Adds the pull request number from the subject of the merge commit that added the fragment to main. A number the
 * builder wrote in the fragment wins.
 *
 * @param {{ fragment: Readonly<Fragment>, subject: string }} params
 * @returns {Readonly<Fragment>}
 */
export function withMergedPr({ fragment, subject }) {
  const merge = MERGE_SUBJECT.exec(subject);
  if (fragment.pr !== undefined || !merge) return fragment;
  return Object.freeze({ ...fragment, pr: Number(merge[1]) });
}

/** The first and last line index of the changelog section, the last one not included. */
const changelogBounds = (/** @type {readonly string[]} */ lines) => {
  const start = lines.indexOf(CHANGELOG_HEADING);
  if (start < 0) throw new OpsError(`PROGRESS.md has no "${CHANGELOG_HEADING}" heading`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return { start, end: next < 0 ? lines.length : next };
};

/**
 * Every changelog entry in PROGRESS.md, newest first. An entry is its `- ` line with any indented lines below it.
 *
 * @param {string} progress The text of PROGRESS.md.
 * @returns {string[]}
 */
export function changelogEntries(progress) {
  const lines = progress.split("\n");
  const { start, end } = changelogBounds(lines);
  /** @type {string[][]} */
  const entries = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line.startsWith("- ")) entries.push([line]);
    else if (/^\s+\S/.test(line) && entries.length > 0) entries.at(-1)?.push(line);
  }
  return entries.map((entry) => entry.join("\n"));
}

/** Newest first: the later day, then the later pull request, then the later ticket. */
const newestFirst = (/** @type {Fragment} */ a, /** @type {Fragment} */ b) =>
  b.date.localeCompare(a.date) ||
  (b.pr ?? 0) - (a.pr ?? 0) ||
  Number(b.ticket.slice(3)) - Number(a.ticket.slice(3));

/** PROGRESS.md with the fragments' lines added above the newest entry, skipping lines it already has. */
const foldChangelog = (/** @type {string} */ progress, /** @type {readonly Fragment[]} */ fragments) => {
  const entries = changelogEntries(progress);
  const added = [...fragments]
    .filter((fragment) => !entries.some((entry) => isLineOf(entry, fragment)))
    .sort(newestFirst)
    .map(renderLine);
  if (added.length === 0) return progress;
  const lines = progress.split("\n");
  const { start, end } = changelogBounds(lines);
  const first = lines.findIndex((line, index) => index > start && index < end && line.startsWith("- "));
  if (first >= 0) {
    lines.splice(first, 0, ...added);
  } else {
    const last = lines.slice(0, end).findLastIndex((line) => line.trim() !== "");
    lines.splice(last + 1, 0, "", ...added);
  }
  return lines.join("\n");
};

/** The Links cell with the fragment's ADRs and, for a finished ticket, its pull request added once. */
const linksWith = (/** @type {string} */ links, /** @type {Fragment} */ fragment) => {
  const adds = fragment.adrs.filter((adr) => !new RegExp(`\\b${adr.slice(0, 7)}\\b`).test(links));
  if (fragment.status === "done" && fragment.pr !== undefined && !links.includes(`#${fragment.pr}`)) {
    adds.push(`done in #${fragment.pr}`);
  }
  const kept = links === "—" ? "" : links;
  return [kept, ...adds].filter((part) => part !== "").join(", ");
};

/**
 * @typedef {object} Table
 * @property {readonly string[]} header The header cells.
 * @property {number} start The line index of the header.
 * @property {number[]} rows The line index of each body row.
 */

/** Every table in a Markdown text, by its header and the line numbers of its rows. */
const tablesOf = (/** @type {readonly string[]} */ lines) => {
  /** @type {Table[]} */
  const tables = [];
  lines.forEach((line, index) => {
    const isRow = line.startsWith("|");
    // A row with no row above it is a header. The line below a header is its separator, so a body row has rows
    // on both of the two lines above it.
    if (isRow && !lines[index - 1]?.startsWith("|"))
      tables.push({ header: cellsOf(line), start: index, rows: [] });
    else if (isRow && lines[index - 2]?.startsWith("|")) tables.at(-1)?.rows.push(index);
  });
  return tables;
};

/** The board with each fragment's row set to its status and links, or added when the ticket is new. */
const foldBoard = (
  /** @type {string} */ backlog,
  /** @type {readonly Fragment[]} */ fragments,
  /** @type {readonly string[]} */ ticketFiles,
) => {
  const lines = backlog.split("\n");
  const tables = tablesOf(lines);
  for (const fragment of fragments) {
    const given = fragment.row === "" ? [] : cellsOf(fragment.row);
    const homes = tables.flatMap((table) =>
      table.rows
        .filter((index) => ticketOf(cellsOf(lines[index])[0]) === fragment.ticket)
        .map((index) => ({ table, index })),
    );
    const last = tables.at(-1);
    if (homes.length === 0 && given.length > 0 && last) {
      const index = (last.rows.at(-1) ?? last.start + 1) + 1;
      lines.splice(index, 0, rowFrom(given));
      last.rows.push(index);
      homes.push({ table: last, index });
    }
    if (homes.length === 0) {
      throw new OpsError(`${fragment.ticket} is not on the board and its fragment has no board row`);
    }
    for (const { table, index } of homes) {
      const status = table.header.indexOf("Status");
      const links = table.header.indexOf("Links");
      if (status < 0 || links < 0) {
        throw new OpsError(`${fragment.ticket}: its board table has no Status and Links columns`);
      }
      const cells = given.length > 0 ? [...given] : cellsOf(lines[index]);
      if (cells.length !== table.header.length) {
        throw new OpsError(
          `${fragment.ticket}: the board row has ${cells.length} cells, the table has ${table.header.length}`,
        );
      }
      cells[status] = STATUSES[fragment.status];
      cells[links] = linksWith(cells[links], fragment);
      if (cells[0] === fragment.ticket && ticketFiles.includes(`${fragment.ticket}.md`)) {
        cells[0] = `[${fragment.ticket}](tickets/${fragment.ticket}.md)`;
      }
      lines[index] = rowFrom(cells);
    }
  }
  return lines.join("\n");
};

/**
 * Folds fragments into PROGRESS.md's changelog and BACKLOG.md's board. Running it again on its own result with the
 * same fragments returns the same text, so a run stopped halfway can simply run again.
 *
 * @param {{ progress: string, backlog: string, fragments: readonly Fragment[], ticketFiles: readonly string[] }}
 *   params The two files' text, the parsed fragments and the names of the files in docs/tickets.
 * @returns {{ progress: string, backlog: string }}
 * @throws {OpsError} When a ticket cannot be placed on the board.
 */
export function collectChanges({ progress, backlog, fragments, ticketFiles }) {
  return {
    progress: foldChangelog(progress, fragments),
    backlog: foldBoard(backlog, fragments, ticketFiles),
  };
}

/**
 * The CI check of a pull request's PROGRESS.md (CC-299). Builders add fragments and never edit the changelog. The
 * one exception is the collector's own pull request: every entry it adds is the line of a fragment that the same
 * pull request deletes, and it changes or removes nothing. That is checked here from the files themselves, so no
 * branch name or label can claim the exception.
 *
 * @param {{ baseProgress: string, headProgress: string, removed: readonly Fragment[] }} params PROGRESS.md on main
 *   and in the pull request, and the fragments the pull request deletes.
 * @returns {string[]} One message per problem, empty when the pull request is fine.
 */
export function guardChangelog({ baseProgress, headProgress, removed }) {
  const base = changelogEntries(baseProgress);
  const head = changelogEntries(headProgress);
  const byHand = head
    .filter((entry) => !base.includes(entry))
    .filter((entry) => !removed.some((fragment) => isLineOf(entry, fragment)))
    .map(
      (entry) =>
        `PROGRESS.md: changelog entry added by hand, add ${CHANGES_FOLDER}/CC-###.md instead: ${entry}`,
    );
  const gone = base
    .filter((entry) => !head.includes(entry))
    .map((entry) => `PROGRESS.md: changelog entry changed or removed: ${entry}`);
  return [...byHand, ...gone];
}
