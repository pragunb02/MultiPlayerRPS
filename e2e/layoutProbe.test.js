import { describe, expect, it } from "vitest";
import { KINDS, VIEWPORTS, formatFinding, sortFindings } from "./layoutProbe.js";

// The parts of the layout probe that need no browser (CC-154): the line a finding prints, the known failures, and
// the viewports. What the probe finds on a real page is tested in layout-probe.spec.js.

const finding = (overrides = {}) => ({
  kind: "overlap",
  screen: "room playing",
  viewport: "320",
  colorScheme: "light",
  element: {
    tag: "button",
    role: "button",
    name: "Rock",
    className: "_choice_x1",
    box: { x: 10, y: 200, width: 96, height: 44 },
  },
  other: {
    tag: "button",
    role: "button",
    name: "Paper",
    className: "_choice_x1",
    box: { x: 90, y: 200, width: 96, height: 44 },
  },
  detail: "two controls overlap by 16×44 px",
  ...overrides,
});

describe("formatFinding (CC-154 AC-6)", () => {
  it("a finding reads without the report", () => {
    const line = formatFinding(finding());

    expect(line).toBe(
      'overlap on room playing at 320 (light): <button "Rock" ._choice_x1> at 10,200 96×44 and <button "Paper" ._choice_x1> at 90,200 96×44: two controls overlap by 16×44 px',
    );
    expect(line).not.toContain("\n");
  });

  it("names the role when it is not the tag, and leaves out what is missing", () => {
    const line = formatFinding(
      finding({
        kind: "clipped",
        element: {
          tag: "span",
          role: "",
          name: "",
          className: "",
          box: { x: 0, y: 0, width: 8, height: 20 },
        },
        other: {
          tag: "div",
          role: "listitem",
          name: "10.",
          className: "",
          box: { x: 0, y: 0, width: 8, height: 20 },
        },
        detail: '"10." is cut off',
      }),
    );

    expect(line).toBe(
      'clipped on room playing at 320 (light): <span> at 0,0 8×20 and <div role=listitem "10."> at 0,0 8×20: "10." is cut off',
    );
  });
});

describe("sortFindings (CC-154 D3)", () => {
  it("keeps a finding a known failure covers apart from the rest, with that failure's ticket", () => {
    const covered = finding();
    const other = finding({ kind: "clipped" });
    const mark = { kind: "overlap", element: /"Rock"/, ticket: "CC-999" };

    const { problems, known, unmatched } = sortFindings([covered, other], [mark]);

    expect(problems).toEqual([other]);
    expect(known).toEqual([{ finding: covered, ticket: "CC-999" }]);
    expect(unmatched).toEqual([]);
  });

  it("matches on the screen and the viewport only when the mark names them", () => {
    const marks = [
      { kind: "overlap", element: /Rock/, screen: /^lobby$/, ticket: "CC-1" },
      { kind: "overlap", element: /Rock/, viewport: "390", ticket: "CC-2" },
    ];

    const { problems, unmatched } = sortFindings([finding()], marks);

    expect(problems).toHaveLength(1);
    expect(unmatched).toEqual(marks);
  });
});

describe("VIEWPORTS (CC-154 D1)", () => {
  it("goes from a 320 px phone to a 1280 px laptop, and has 200 % zoom of that laptop as 640 × 360", () => {
    expect(VIEWPORTS.map(({ width }) => width)).toEqual([320, 360, 390, 768, 1024, 1280, 640]);
    expect(VIEWPORTS.find(({ name }) => name === "200% zoom")).toEqual({
      name: "200% zoom",
      width: 640,
      height: 360,
    });
  });

  it("checks every kind the ticket names", () => {
    expect(KINDS).toEqual([
      "clipped",
      "overflow",
      "page-scroll",
      "overlap",
      "covered",
      "small-target",
      "contrast",
    ]);
  });
});
