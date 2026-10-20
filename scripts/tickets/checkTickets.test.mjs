import { describe, expect, it } from "vitest";

import { GATED, STATUSES, checkTicket, isTemplateName, ticketStatus } from "./checkTickets.mjs";

const TODAY = "2026-10-20";

const HEADER = [
  "| Question | Options | Recommended default | Owner answer | Default applies on |",
  "| -------- | ------- | ------------------- | ------------ | ------------------ |",
];

/** An Open decisions table with these rows. */
const decisionRows = (/** @type {string[]} */ ...rows) => [...HEADER, ...rows];

/** A ticket file from the parts the gate reads. An empty template leaves its row out, and `omit` a section. */
const ticket = ({
  status = "Ready",
  template = "full",
  decisions = decisionRows("| Which copy? | A, B | A | B | 2026-10-22 |"),
  omitDecisions = false,
  criteria = ["- **AC-1** Given a player, when they tap, then it answers. Test: `answers a tap`"],
} = {}) =>
  [
    "# CC-400 — A ticket",
    "",
    "|          |      |",
    "| -------- | ---- |",
    ...(template === "" ? [] : [`| Template | ${template} |`]),
    `| Status   | ${status} |`,
    "",
    ...(omitDecisions ? [] : ["## Open decisions", "", ...decisions, ""]),
    "## Acceptance criteria",
    "",
    ...criteria,
    "",
    "## Test plan",
    "",
    "- AC-9 is only mentioned here.",
    "",
  ].join("\n");

const check = (/** @type {Parameters<typeof ticket>[0]} */ parts = {}, today = TODAY) =>
  checkTicket({ name: "CC-400.md", text: ticket(parts), today });

describe("ticketStatus", () => {
  it("reads a status word, with or without a note after it", () => {
    expect(ticketStatus(ticket({ status: "Spec review" }))).toBe("Spec review");
    expect(ticketStatus(ticket({ status: "Ready (owner answered 2026-10-21)" }))).toBe("Ready");
  });

  it("gives an empty string for an older ticket, whose status starts with an emoji, and for none", () => {
    expect(ticketStatus(ticket({ status: "✅ Done" }))).toBe("");
    expect(ticketStatus("# CC-001\n\nNo table.\n")).toBe("");
    expect(ticketStatus("# CC-001\n\n| Status |\n")).toBe("");
  });

  it("does not take a longer word for a status", () => {
    expect(ticketStatus(ticket({ status: "Readying" }))).toBe("");
  });

  it("reads files with Windows line ends", () => {
    expect(ticketStatus(ticket({ status: "Building" }).replace(/\n/g, "\r\n"))).toBe("Building");
  });
});

describe("checkTicket", () => {
  it("passes a Ready ticket whose decisions are answered and which has a criterion", () => {
    expect(check()).toEqual([]);
  });

  it("checks nothing before Ready, nor an older ticket", () => {
    const empty = { decisions: decisionRows("| | | | | |"), criteria: [] };
    expect(check({ ...empty, status: "Shaping" })).toEqual([]);
    expect(check({ ...empty, status: "Spec review" })).toEqual([]);
    expect(check({ ...empty, status: "✅ Done" })).toEqual([]);
  });

  it("applies the gate at every status from Ready on", () => {
    expect(GATED).toEqual(STATUSES.slice(2));
    for (const status of GATED) {
      expect(check({ status, criteria: [] })).toEqual([
        `docs/tickets/CC-400.md (${status}): the Acceptance criteria section needs at least one criterion with an id, AC-1`,
      ]);
    }
  });

  it("fails an unanswered decision whose default day has not come", () => {
    expect(check({ decisions: decisionRows("| Which copy? | A, B | A | | 2026-10-21 |") })).toEqual([
      "docs/tickets/CC-400.md (Ready): Open decisions row 1: no owner answer, and its default applies only on 2026-10-21",
    ]);
  });

  it("passes an unanswered decision on and after its default day", () => {
    const decisions = decisionRows("| Which copy? | A, B | A | | 2026-10-20 |");
    expect(check({ decisions })).toEqual([]);
    expect(check({ decisions }, "2026-11-01")).toEqual([]);
  });

  it("fails an unanswered decision with no default day, or one that is not a real day", () => {
    for (const day of ["", "soon", "2026-02-30"]) {
      expect(check({ decisions: decisionRows(`| Which copy? | A, B | A | — | ${day} |`) })).toEqual([
        "docs/tickets/CC-400.md (Ready): Open decisions row 1: no owner answer and no default day written YYYY-MM-DD",
      ]);
    }
  });

  it("fails a row whose question, options or default is empty or still the template's placeholder", () => {
    expect(check({ decisions: decisionRows("| … | <options> | TBD | Yes | |") })).toEqual([
      "docs/tickets/CC-400.md (Ready): Open decisions row 1: the question is empty",
      "docs/tickets/CC-400.md (Ready): Open decisions row 1: the options is empty",
      "docs/tickets/CC-400.md (Ready): Open decisions row 1: the recommended default is empty",
    ]);
  });

  it("fails a short row as empty", () => {
    expect(check({ decisions: decisionRows("| Which copy? |") })).toHaveLength(3);
  });

  it("reads bold cells and a pipe written inside a cell", () => {
    expect(
      check({ decisions: decisionRows("| Which \\| copy? | A, B | **A** | | **2026-10-19** |") }),
    ).toEqual([]);
  });

  it("numbers each failing row", () => {
    const decisions = decisionRows("| One? | A, B | A | A | |", "| Two? | A, B | A | | 2026-12-01 |");
    expect(check({ decisions })).toEqual([
      "docs/tickets/CC-400.md (Ready): Open decisions row 2: no owner answer, and its default applies only on 2026-12-01",
    ]);
  });

  it("passes a full ticket that has the section and no decisions", () => {
    expect(check({ decisions: ["None."] })).toEqual([]);
  });

  it("fails a full ticket with no Open decisions section, and passes a lite one", () => {
    expect(check({ omitDecisions: true })).toEqual([
      "docs/tickets/CC-400.md (Ready): a full ticket needs an Open decisions section (a table, or the word None)",
    ]);
    expect(check({ template: "lite", omitDecisions: true })).toEqual([]);
  });

  it("fails a ticket that does not name its template", () => {
    expect(check({ template: "" })).toEqual([
      "docs/tickets/CC-400.md (Ready): the Template row must say full or lite",
    ]);
    expect(check({ template: "short" })).toHaveLength(1);
  });

  it("counts criteria only inside the Acceptance criteria section", () => {
    expect(check({ criteria: ["Given a player, when they tap, then it answers."] })).toHaveLength(1);
  });

  it("reads a section that ends the file", () => {
    const text = "| Template | lite |\n| Status | Done |\n\n## Acceptance criteria\n\n- AC-1 It answers.";
    expect(checkTicket({ name: "CC-400.md", text, today: TODAY })).toEqual([]);
  });

  it("fails a criterion id used twice", () => {
    expect(check({ criteria: ["- AC-1 one", "- AC-2 two", "- AC-1 again", "- AC-2 again"] })).toEqual([
      "docs/tickets/CC-400.md (Ready): acceptance criterion ids used twice: AC-1, AC-2",
    ]);
  });
});

describe("the ticket files", () => {
  it("knows the template files are not tickets", () => {
    expect(isTemplateName("TEMPLATE.md")).toBe(true);
    expect(isTemplateName("TEMPLATE-lite.md")).toBe(true);
    expect(isTemplateName("CC-311.md")).toBe(false);
  });
});
