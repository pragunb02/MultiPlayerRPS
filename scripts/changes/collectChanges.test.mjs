import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import {
  changelogEntries,
  collectChanges,
  guardChangelog,
  isFragmentName,
  parseFragment,
  renderLine,
  parseOptions,
  withMergedPr,
} from "./collectChanges.mjs";

/** A fragment's text, from front matter lines and a body. */
const fragmentText = ({
  front = ["ticket: CC-310", "date: 2026-10-21", "type: bug", "status: done", "adrs: []"],
  body = "Fixed the thing.",
} = {}) => `---\n${front.join("\n")}\n---\n\n${body}\n`;

/** A parsed fragment, changed by the overrides. */
const fragment = (overrides = {}) =>
  parseFragment({ name: `${overrides.ticket ?? "CC-310"}.md`, text: fragmentText(overrides) });

const progress = (entries = ["- 2026-10-20 — CC-305 — (#131) An older change."]) =>
  [
    "# Progress",
    "",
    "## Status",
    "",
    "| a | b |",
    "",
    "## Changelog",
    "",
    "Newest first. Format: `YYYY-MM-DD — <ticket IDs> — what changed`.",
    "",
    ...entries,
    "",
  ].join("\n");

const backlog = (/** @type {string[]} */ more = []) =>
  [
    "# Backlog",
    "",
    "| ID     | Title | Type | Pri | Phase | Status  | Links  |",
    "| ------ | ----- | ---- | --- | ----- | ------- | ------ |",
    "| CC-001 | Old   | docs | P1  | 0     | ✅ Done | ADR-001 |",
    "",
    "## Later",
    "",
    "| ID     | Title  | Type | Pri | Stage | Phase | Status  | Links |",
    "| ------ | ------ | ---- | --- | ----- | ----- | ------- | ----- |",
    "| CC-310 | A bug  | bug  | P1  | S1    | 1     | ⬜ Todo | CC-289 |",
    "| CC-311 | Other  | bug  | P1  | S1    | 1     | ⬜ Todo |       |",
    ...more,
    "",
  ].join("\n");

/** The cells of the board row for one ticket. */
const rowOf = (/** @type {string} */ board, /** @type {string} */ ticket) =>
  board
    .split("\n")
    .find((line) => line.includes(`${ticket}`) && line.startsWith("|"))
    ?.split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());

const collect = (/** @type {Partial<Parameters<typeof collectChanges>[0]>} */ overrides = {}) =>
  collectChanges({
    progress: progress(),
    backlog: backlog(),
    fragments: [fragment()],
    ticketFiles: [],
    ...overrides,
  });

describe("parseOptions", () => {
  it("folds by default, checks with --check, and compares with a ref given to --base", () => {
    expect(parseOptions([])).toEqual({ check: false, base: "" });
    expect(parseOptions(["--check"])).toEqual({ check: true, base: "" });
    expect(parseOptions(["--base", "HEAD^1", "--check"])).toEqual({ check: true, base: "HEAD^1" });
  });

  it.each([
    [["--bogus"]],
    [["--check", "--check"]],
    [["--base", "HEAD^1"]],
    [["--check", "--base"]],
    [["--check", "--base", "--upload-pack=x"]],
    [["--check", "--base", "main; rm"]],
  ])("rejects %j", (argv) => {
    expect(() => parseOptions(argv)).toThrow(OpsError);
  });
});

describe("isFragmentName", () => {
  it("accepts a ticket ID file and nothing else", () => {
    expect(isFragmentName("CC-299.md")).toBe(true);
    expect(isFragmentName("CC-1299.md")).toBe(true);
    expect(["README.md", "cc-299.md", "CC-29.md", "CC-299.txt", "CC-299-two.md"].some(isFragmentName)).toBe(
      false,
    );
  });
});

describe("parseFragment", () => {
  it("reads the front matter and the changelog text", () => {
    const parsed = parseFragment({
      name: "CC-310.md",
      text: fragmentText({
        front: [
          "ticket: CC-310",
          "date: 2026-10-21",
          "type: security",
          "status: in-progress",
          "adrs: [ADR-068, ADR-055 (amended)]",
          "pr: 140",
        ],
        body: "First line\nwraps here.",
      }),
    });

    expect(parsed).toEqual({
      ticket: "CC-310",
      date: "2026-10-21",
      type: "security",
      status: "in-progress",
      adrs: ["ADR-068", "ADR-055 (amended)"],
      pr: 140,
      text: "First line wraps here.",
      row: "",
    });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("keeps one board row apart from the text", () => {
    const parsed = fragment({
      body: "Fixed it.\n\n| CC-310 | A bug, renamed | bug | P1 | S1 | 1 | ⬜ Todo | |",
    });

    expect(parsed.text).toBe("Fixed it.");
    expect(parsed.row).toBe("| CC-310 | A bug, renamed | bug | P1 | S1 | 1 | ⬜ Todo | |");
  });

  it.each([
    ["no front matter", "Just text.\n", /front matter/],
    ["front matter that is not a mapping", "---\n- a\n---\nText.\n", /front matter/],
    ["front matter that is not YAML", "---\na: [\n---\nText.\n", /front matter/],
  ])("rejects %s", (_, text, message) => {
    expect(() => parseFragment({ name: "CC-310.md", text })).toThrow(message);
  });

  it.each([
    ["a ticket that differs from the file name", { front: ["ticket: CC-311"] }, /ticket must be CC-310/],
    ["a date that is not a day", { front: ["date: 2026-13-01"] }, /date/],
    ["a date in the wrong format", { front: ["date: 20 October"] }, /date/],
    ["an unknown type", { front: ["type: feat"] }, /type/],
    ["an unknown status", { front: ["status: finished"] }, /status/],
    ["ADRs that are not a list", { front: ["adrs: ADR-068"] }, /adrs/],
    ["a malformed ADR", { front: ["adrs: [ADR-68]"] }, /adrs/],
    ["a PR that is not a number", { front: ["pr: abc"] }, /pr/],
    ["an unknown key", { front: ["owner: me"] }, /unknown key owner/],
    ["an empty changelog text", { body: "" }, /changelog text/],
    ["two board rows", { body: "Text.\n| CC-310 | a |\n| CC-310 | b |" }, /one board row/],
    ["a board row for another ticket", { body: "Text.\n| CC-311 | a |" }, /board row must start with CC-310/],
  ])("rejects %s", (_, change, message) => {
    const base = { ticket: "CC-310", date: "2026-10-21", type: "bug", status: "done", adrs: "[]" };
    const front = Object.entries(base)
      .filter(([key]) => !change.front?.some((line) => line.startsWith(`${key}:`)))
      .map(([key, value]) => `${key}: ${value}`)
      .concat(change.front ?? []);

    expect(() =>
      parseFragment({ name: "CC-310.md", text: fragmentText({ front, body: change.body }) }),
    ).toThrow(message);
  });

  it("names the file and every problem at once, as an error the operator can fix", () => {
    const text = fragmentText({ front: ["ticket: CC-310", "date: x", "type: y", "status: z", "adrs: []"] });

    expect(() => parseFragment({ name: "CC-310.md", text })).toThrow(OpsError);
    expect(() => parseFragment({ name: "CC-310.md", text })).toThrow(/CC-310\.md: .*date.*type.*status/s);
  });

  it("rejects a file name that is not a ticket ID", () => {
    expect(() => parseFragment({ name: "notes.md", text: fragmentText() })).toThrow(/CC-###\.md/);
  });
});

describe("renderLine", () => {
  it("writes the existing changelog format, ADRs after the ticket, the PR first in the text", () => {
    const line = renderLine(
      fragment({
        front: [
          "ticket: CC-310",
          "date: 2026-10-21",
          "type: bug",
          "status: done",
          "adrs: [ADR-055 (amended)]",
          "pr: 9",
        ],
      }),
    );

    expect(line).toBe("- 2026-10-21 — CC-310, ADR-055 (amended) — (#9) Fixed the thing.");
  });

  it("leaves the PR out when it is not known", () => {
    expect(renderLine(fragment())).toBe("- 2026-10-21 — CC-310 — Fixed the thing.");
  });
});

describe("withMergedPr", () => {
  it("takes the PR number from the merge commit that added the fragment", () => {
    expect(
      withMergedPr({ fragment: fragment(), subject: "Merge pull request #140 from a/cc-310-x" }).pr,
    ).toBe(140);
  });

  it("keeps a PR the builder wrote, and changes nothing when the subject is not a merge", () => {
    const own = fragment({
      front: ["ticket: CC-310", "date: 2026-10-21", "type: bug", "status: done", "adrs: []", "pr: 7"],
    });

    expect(withMergedPr({ fragment: own, subject: "Merge pull request #140 from a/b" }).pr).toBe(7);
    expect(withMergedPr({ fragment: fragment(), subject: "CC-310: fix it" }).pr).toBeUndefined();
  });
});

describe("collectChanges, the changelog", () => {
  it("adds the line above the newest entry", () => {
    const { progress: folded } = collect();

    expect(changelogEntries(folded)).toEqual([
      "- 2026-10-21 — CC-310 — Fixed the thing.",
      "- 2026-10-20 — CC-305 — (#131) An older change.",
    ]);
    expect(folded.startsWith("# Progress\n\n## Status\n\n| a | b |\n")).toBe(true);
  });

  it("puts several fragments newest first: by date, then PR, then ticket", () => {
    const make = (/** @type {string} */ ticket, /** @type {string} */ date, /** @type {string} */ pr) =>
      fragment({
        ticket,
        front: [`ticket: ${ticket}`, `date: ${date}`, "type: bug", "status: done", "adrs: []", pr],
      });
    const fragments = [
      make("CC-312", "2026-10-21", "pr: 141"),
      make("CC-313", "2026-10-22", ""),
      make("CC-311", "2026-10-21", "pr: 150"),
      make("CC-315", "2026-10-21", ""),
      make("CC-314", "2026-10-21", ""),
    ];

    const tickets = changelogEntries(
      collect({
        fragments,
        backlog: backlog(
          ["CC-312", "CC-313", "CC-314", "CC-315"].map(
            (id) => `| ${id} | X | bug | P1 | S1 | 1 | ⬜ Todo | |`,
          ),
        ),
      }).progress,
    ).map((line) => line.split(" — ")[1]);

    expect(tickets).toEqual(["CC-313", "CC-311", "CC-312", "CC-315", "CC-314", "CC-305"]);
  });

  it("keeps entries with sub-points as one entry", () => {
    const entries = changelogEntries(
      progress(["- 2026-10-20 — CC-305 — Top.", "  - A point.", "- 2026-10-19 — X — Y."]),
    );

    expect(entries).toEqual(["- 2026-10-20 — CC-305 — Top.\n  - A point.", "- 2026-10-19 — X — Y."]);
  });

  it("adds to an empty changelog", () => {
    expect(changelogEntries(collect({ progress: progress([]) }).progress)).toEqual([
      "- 2026-10-21 — CC-310 — Fixed the thing.",
    ]);
  });

  it("stops the changelog at the next heading", () => {
    const text = `${progress()}\n## Later\n\n- not an entry\n`;

    expect(changelogEntries(text)).toEqual(["- 2026-10-20 — CC-305 — (#131) An older change."]);
  });

  it("fails when PROGRESS.md has no changelog", () => {
    expect(() => collect({ progress: "# Progress\n" })).toThrow(/## Changelog/);
  });
});

describe("collectChanges, the board", () => {
  it("sets the status, adds the ADRs and the PR to the links, and links the ticket file", () => {
    const done = fragment({
      front: [
        "ticket: CC-310",
        "date: 2026-10-21",
        "type: bug",
        "status: done",
        "adrs: [ADR-068]",
        "pr: 140",
      ],
    });

    const { backlog: board } = collect({ fragments: [done], ticketFiles: ["CC-310.md"] });

    expect(rowOf(board, "CC-310")).toEqual([
      "[CC-310](tickets/CC-310.md)",
      "A bug",
      "bug",
      "P1",
      "S1",
      "1",
      "✅ Done",
      "CC-289, ADR-068, done in #140",
    ]);
  });

  it.each([
    ["todo", "⬜ Todo"],
    ["in-progress", "🟦 In progress"],
    ["blocked", "⛔ Blocked"],
  ])("writes the %s status without a done mark", (status, cell) => {
    const open = fragment({
      front: ["ticket: CC-311", "date: 2026-10-21", "type: bug", `status: ${status}`, "adrs: []", "pr: 3"],
      ticket: "CC-311",
    });

    const row = rowOf(collect({ fragments: [open] }).backlog, "CC-311");

    expect(row?.[6]).toBe(cell);
    expect(row?.[7]).toBe("");
  });

  it("does not repeat an ADR already in the links, and changes no other row", () => {
    const withAdr = fragment({
      front: ["ticket: CC-310", "date: 2026-10-21", "type: bug", "status: done", "adrs: [ADR-001]"],
    });
    const board = backlog().replace("| ⬜ Todo | CC-289 |", "| ⬜ Todo | ADR-001 (amended) |");

    const folded = collect({ backlog: board, fragments: [withAdr] }).backlog;

    expect(rowOf(folded, "CC-310")?.[7]).toBe("ADR-001 (amended)");
    expect(rowOf(folded, "CC-001")).toEqual(rowOf(board, "CC-001"));
    expect(rowOf(folded, "CC-311")).toEqual(rowOf(board, "CC-311"));
  });

  it("fills an empty links cell", () => {
    const done = fragment({
      ticket: "CC-311",
      front: ["ticket: CC-311", "date: 2026-10-21", "type: bug", "status: done", "adrs: [ADR-068]", "pr: 4"],
    });

    expect(rowOf(collect({ fragments: [done] }).backlog, "CC-311")?.[7]).toBe("ADR-068, done in #4");
  });

  it("replaces a links cell that holds only a dash", () => {
    const board = backlog().replace("| ⬜ Todo | CC-289 |", "| ⬜ Todo | — |");
    const done = fragment({
      front: ["ticket: CC-310", "date: 2026-10-21", "type: bug", "status: done", "adrs: []", "pr: 5"],
    });

    expect(rowOf(collect({ backlog: board, fragments: [done] }).backlog, "CC-310")?.[7]).toBe("done in #5");
  });

  it("adds a new row under the header of a table that has no rows yet, and fails with no table at all", () => {
    const front = ["ticket: CC-320", "date: 2026-10-21", "type: test", "status: todo", "adrs: []"];
    const added = fragment({ ticket: "CC-320", front, body: "Started.\n| CC-320 | x | |" });
    const empty = "# Backlog\n\n| ID | Status | Links |\n| -- | ------ | ----- |\n";

    expect(collect({ backlog: empty, fragments: [added] }).backlog.split("\n")[4]).toBe(
      "| CC-320 | ⬜ Todo |  |",
    );
    expect(() => collect({ backlog: "# Backlog\n", fragments: [added] })).toThrow(
      /CC-320 is not on the board/,
    );
  });

  it("replaces a row with the fragment's own row, then applies the status", () => {
    const renamed = fragment({
      body: "Text.\n| CC-310 | A bug, renamed | bug | P0 | S1 | 1 | ⬜ Todo | CC-289 |",
    });

    const row = rowOf(collect({ fragments: [renamed] }).backlog, "CC-310");

    expect(row?.slice(1, 4)).toEqual(["A bug, renamed", "bug", "P0"]);
    expect(row?.[6]).toBe("✅ Done");
  });

  it("appends a new ticket's row to the last table", () => {
    const added = fragment({
      ticket: "CC-320",
      front: ["ticket: CC-320", "date: 2026-10-21", "type: test", "status: in-progress", "adrs: []"],
      body: "Started.\n| CC-320 | New | test | P2 | S0 | 0 | ⬜ Todo | CC-299 |",
    });

    const lines = collect({ fragments: [added] }).backlog.split("\n");

    expect(lines.at(-2)).toBe("| CC-320 | New | test | P2 | S0 | 0 | 🟦 In progress | CC-299 |");
    expect(lines.at(-3)).toContain("CC-311");
  });

  it("fails when a new row has the wrong number of cells for the last table", () => {
    const added = fragment({
      ticket: "CC-320",
      front: ["ticket: CC-320", "date: 2026-10-21", "type: test", "status: todo", "adrs: []"],
      body: "Started.\n| CC-320 | New |",
    });

    expect(() => collect({ fragments: [added] })).toThrow(
      /CC-320: the board row has 2 cells, the table has 8/,
    );
  });

  it("fails when the ticket is not on the board and the fragment gives no row", () => {
    const unknown = fragment({
      ticket: "CC-399",
      front: ["ticket: CC-399", "date: 2026-10-21", "type: bug", "status: done", "adrs: []"],
    });

    expect(() => collect({ fragments: [unknown] })).toThrow(/CC-399 is not on the board/);
  });

  it("fails when a table has no Status or Links column", () => {
    const board = "| ID | Title |\n| -- | ----- |\n| CC-310 | A |\n";

    expect(() => collect({ backlog: board })).toThrow(/Status and Links/);
  });

  it("keeps escaped pipes inside a cell", () => {
    const board = backlog().replace("| A bug  |", "| A \\| B |");

    expect(rowOf(collect({ backlog: board }).backlog, "CC-310")?.[6]).toBe("✅ Done");
    expect(collect({ backlog: board }).backlog).toContain("A \\| B");
  });
});

describe("collectChanges, a second run", () => {
  it("changes nothing", () => {
    const done = fragment({
      front: [
        "ticket: CC-310",
        "date: 2026-10-21",
        "type: bug",
        "status: done",
        "adrs: [ADR-068]",
        "pr: 140",
      ],
    });
    const once = collect({ fragments: [done], ticketFiles: ["CC-310.md"] });

    const twice = collect({ ...once, fragments: [done], ticketFiles: ["CC-310.md"] });

    expect(twice).toEqual(once);
  });

  it("does not add a line again when the fragment was folded with its PR already written", () => {
    const once = collect({ fragments: [fragment()] });
    const merged = withMergedPr({ fragment: fragment(), subject: "Merge pull request #140 from a/b" });

    expect(changelogEntries(collect({ ...once, fragments: [fragment()] }).progress)).toHaveLength(2);
    expect(changelogEntries(collect({ ...once, fragments: [merged] }).progress)).toHaveLength(2);
  });
});

describe("guardChangelog", () => {
  const base = progress();

  it("passes a pull request that leaves the changelog alone", () => {
    expect(guardChangelog({ baseProgress: base, headProgress: `${base}`, removed: [] })).toEqual([]);
  });

  it("fails a pull request that adds a changelog line by hand", () => {
    const head = progress([
      "- 2026-10-21 — CC-310 — By hand.",
      "- 2026-10-20 — CC-305 — (#131) An older change.",
    ]);

    expect(guardChangelog({ baseProgress: base, headProgress: head, removed: [] })).toEqual([
      "PROGRESS.md: changelog entry added by hand, add docs/changes/CC-###.md instead: - 2026-10-21 — CC-310 — By hand.",
    ]);
  });

  it("fails a pull request that changes or removes a changelog line", () => {
    const head = progress(["- 2026-10-20 — CC-305 — (#131) Reworded."]);

    expect(guardChangelog({ baseProgress: base, headProgress: head, removed: [] })).toEqual([
      "PROGRESS.md: changelog entry added by hand, add docs/changes/CC-###.md instead: - 2026-10-20 — CC-305 — (#131) Reworded.",
      "PROGRESS.md: changelog entry changed or removed: - 2026-10-20 — CC-305 — (#131) An older change.",
    ]);
  });

  it("passes the collector's pull request: each new line comes from a fragment it deletes", () => {
    const folded = collect({ fragments: [fragment()] }).progress;
    const merged = withMergedPr({ fragment: fragment(), subject: "Merge pull request #140 from a/b" });

    expect(guardChangelog({ baseProgress: base, headProgress: folded, removed: [fragment()] })).toEqual([]);
    const foldedWithPr = collect({ fragments: [merged] }).progress;
    expect(guardChangelog({ baseProgress: base, headProgress: foldedWithPr, removed: [fragment()] })).toEqual(
      [],
    );
  });

  it("fails a collector run whose line differs from the deleted fragment", () => {
    const folded = collect({ fragments: [fragment()] }).progress.replace(
      "Fixed the thing.",
      "Fixed it better.",
    );

    expect(guardChangelog({ baseProgress: base, headProgress: folded, removed: [fragment()] })).toHaveLength(
      1,
    );
  });
});

describe("docs/changes", () => {
  it("holds only valid fragments and its README", () => {
    const folder = new URL("../../docs/changes/", import.meta.url);
    const names = readdirSync(folder).filter((name) => name !== "README.md");

    const parsed = names.map((name) =>
      parseFragment({ name, text: readFileSync(new URL(name, folder), "utf8") }),
    );

    expect(parsed.map((change) => `${change.ticket}.md`)).toEqual(names);
  });
});
