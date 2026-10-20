// The decision gate in CI (CC-311, ADR-072). A ticket written from the full or the lite template
// (docs/tickets/TEMPLATE.md, TEMPLATE-lite.md) names its status in plain words. From Ready on, a builder may work on
// it, so by then every open decision must be answered by the owner or past the day its default applies, and the
// ticket must have at least one acceptance criterion with an id (AC-1, AC-2…). Older tickets, whose Status cell
// starts with an emoji (✅ Done, 🟦 In progress), are not checked. scripts/bin/check-tickets.mjs runs this on every
// ticket file in the Changelog fragments job.

/** The statuses of a ticket written from the CC-311 templates, in order. */
export const STATUSES = Object.freeze([
  "Shaping",
  "Spec review",
  "Ready",
  "Building",
  "Rolling out",
  "Done",
  "Reviewed",
]);

/** The statuses from which a builder may work on the ticket, so the gate applies. */
export const GATED = Object.freeze(STATUSES.slice(STATUSES.indexOf("Ready")));

/** The templates a ticket can be written from, named in its Template row. */
export const TEMPLATES = Object.freeze(["full", "lite"]);

/** The template files themselves, which are not tickets. */
export const isTemplateName = (/** @type {string} */ name) => /^TEMPLATE(-[a-z]+)?\.md$/.test(name);

const DECISION_COLUMNS = Object.freeze([
  "question",
  "options",
  "recommended default",
  "owner answer",
  "default applies on",
]);
// A cell left as the template wrote it counts as empty.
const PLACEHOLDER = /^(|…|\.\.\.|-|—|tbd|todo|\?|<[^>]*>)$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * From this day on, a full `feature` ticket at Ready or later names at least one Friction guardrail row in its Success
 * metric table (CC-313 section 6, owner 2026-10-20). Tickets started before it are not checked, as CC-311 did.
 */
export const FRICTION_GUARDRAIL_FROM = "2026-10-21";
/** The Kind of the row a feature ticket must have. */
export const FRICTION_GUARDRAIL = "Friction guardrail";
const AC_ID = /\bAC-(\d+)\b/g;

/** The cells of a Markdown table row. A pipe written as `\|` stays inside its cell. */
const cellsOf = (/** @type {string} */ line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

const isEmpty = (/** @type {string | undefined} */ cell) => PLACEHOLDER.test((cell ?? "").replace(/\*/g, ""));

/** Whether a string is a real calendar day in `YYYY-MM-DD` form. */
const isDay = (/** @type {string} */ value) =>
  DAY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** The value of a row in the ticket's head table, such as Status, or an empty string when there is none. */
const headCell = (/** @type {string[]} */ lines, /** @type {string} */ field) => {
  const row = lines.find((line) => line.startsWith("|") && cellsOf(line)[0] === field);
  return row === undefined ? "" : (cellsOf(row)[1] ?? "");
};

/** Whether the ticket has a `## ` section, and its lines without the heading (none when it has no such section). */
const section = (/** @type {string[]} */ lines, /** @type {string} */ heading) => {
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return { found: false, lines: [] };
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return { found: true, lines: lines.slice(start + 1, end === -1 ? lines.length : end) };
};

/**
 * The status of a ticket written from the CC-311 templates, or an empty string for an older ticket. The Status
 * cell starts with the status word, optionally followed by a note: `Ready (owner answered 2026-10-21)`.
 *
 * @param {string} text The ticket file.
 * @returns {string}
 */
export function ticketStatus(text) {
  const cell = headCell(text.replace(/\r\n/g, "\n").split("\n"), "Status");
  return STATUSES.find((status) => cell === status || cell.startsWith(`${status} `)) ?? "";
}

/**
 * The problems in one Open decisions row, given today's date. A row is complete when its question, options and
 * recommended default are written, and it is either answered by the owner or its default applies on a day that has
 * come.
 */
const decisionProblems = (
  /** @type {string[]} */ cells,
  /** @type {number} */ number,
  /** @type {string} */ today,
) => {
  const problems = DECISION_COLUMNS.slice(0, 3)
    .filter((_, index) => isEmpty(cells[index]))
    .map((column) => `Open decisions row ${number}: the ${column} is empty`);
  if (!isEmpty(cells[3])) return problems;
  const day = (cells[4] ?? "").replace(/\*/g, "");
  if (!isDay(day)) {
    problems.push(`Open decisions row ${number}: no owner answer and no default day written YYYY-MM-DD`);
  } else if (day > today) {
    problems.push(`Open decisions row ${number}: no owner answer, and its default applies only on ${day}`);
  }
  return problems;
};

/**
 * Checks one ticket file against the decision gate. Tickets before Ready, and older tickets, have no problems.
 *
 * @param {{ name: string, text: string, today: string }} params The file name, its content and today, YYYY-MM-DD.
 * @returns {string[]} One line per problem, each starting with the file name. Empty when the ticket passes.
 */
export function checkTicket({ name, text, today }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const status = ticketStatus(text);
  if (!GATED.includes(status)) return [];
  const problems = [];
  const template = headCell(lines, "Template");
  if (!TEMPLATES.includes(template)) {
    problems.push(`the Template row must say ${TEMPLATES.join(" or ")}`);
  }

  const decisions = section(lines, "Open decisions");
  if (!decisions.found && template !== "lite") {
    problems.push("a full ticket needs an Open decisions section (a table, or the word None)");
  }
  const rows = decisions.lines.filter((line) => line.trim().startsWith("|")).slice(2);
  rows.forEach((line, index) => problems.push(...decisionProblems(cellsOf(line), index + 1, today)));

  const criteria = section(lines, "Acceptance criteria").lines.join("\n");
  const ids = [...criteria.matchAll(AC_ID)].map((match) => `AC-${match[1]}`);
  if (ids.length === 0) {
    problems.push("the Acceptance criteria section needs at least one criterion with an id, AC-1");
  }
  const repeated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (repeated.length > 0) problems.push(`acceptance criterion ids used twice: ${repeated.join(", ")}`);

  const started = headCell(lines, "Started");
  const isNewFeature =
    template === "full" &&
    headCell(lines, "Type") === "feature" &&
    isDay(started) &&
    started >= FRICTION_GUARDRAIL_FROM;
  const kinds = section(lines, "Success metric")
    .lines.filter((line) => line.trim().startsWith("|"))
    .map((line) => cellsOf(line)[0].replace(/\*/g, ""));
  if (isNewFeature && !kinds.includes(FRICTION_GUARDRAIL)) {
    problems.push(
      `a feature ticket started on or after ${FRICTION_GUARDRAIL_FROM} needs a ${FRICTION_GUARDRAIL} row in its Success metric table (CC-313)`,
    );
  }

  return problems.map((problem) => `docs/tickets/${name} (${status}): ${problem}`);
}
