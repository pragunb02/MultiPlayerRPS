import { describe, expect, it } from "vitest";
import { PROBLEMS, checkComment, proseOf } from "./commentCheck.mjs";

describe("proseOf", () => {
  it("blanks out code, URLs and stars but keeps the length and the line breaks", () => {
    const text = "*\n * Run `a;b` at https://x.io/a;b.\n * @param {{ a: 1; b: 2 }} pair The pair.\n ";
    const prose = proseOf(text, { jsdoc: true });
    expect(prose).toHaveLength(text.length);
    expect(prose.split("\n")).toHaveLength(text.split("\n").length);
    expect(prose).not.toMatch(/[;*`{}]|https/);
    expect(prose).toContain("Run");
    expect(prose).toContain("The pair.");
  });

  it("keeps braces in comments that are not JSDoc", () => {
    expect(proseOf(" Returns {a}. ", { jsdoc: false })).toBe(" Returns {a}. ");
  });

  it("blanks out an @example section up to the next tag", () => {
    const prose = proseOf("*\n * @example\n * run(); // => x\n * @returns {void} Nothing.\n", {
      jsdoc: true,
    });
    expect(prose).not.toContain("run");
    expect(prose).toContain("@returns");
    expect(prose).toContain("Nothing.");
  });
});

describe("checkComment", () => {
  it("returns a frozen empty list for a clean comment", () => {
    const problems = checkComment(" All good, nothing to see.", { block: false });
    expect(problems).toEqual([]);
    expect(Object.isFrozen(problems)).toBe(true);
  });

  it("reports the problem, where it starts and what was found", () => {
    const [problem] = checkComment(" One; two.", { block: false });
    expect(problem).toEqual({ id: "semicolon", index: 4, found: ";" });
    expect(Object.isFrozen(problem)).toBe(true);
  });

  it("points at the hyphen of a bullet, not at the spaces in front of it", () => {
    expect(checkComment("   - item", { block: false })).toEqual([
      { id: "hyphenBullet", index: 3, found: "-" },
    ]);
  });

  it("reads a block comment as JSDoc only when it starts with a star", () => {
    expect(checkComment("* @param {{ a; b }} x The x.", { block: true })).toEqual([]);
    expect(checkComment(" {{ a; b }} ", { block: true }).map(({ id }) => id)).toEqual(["semicolon"]);
    expect(checkComment("* {{ a; b }}", { block: false }).map(({ id }) => id)).toEqual(["semicolon"]);
  });

  it("skips tool directives", () => {
    for (const directive of [
      "eslint-disable-line no-var; x",
      "globals a; b",
      "@vitest-environment jsdom; x",
    ]) {
      expect(checkComment(directive, { block: false })).toEqual([]);
    }
  });

  it("has advice for every kind of problem", () => {
    expect(Object.keys(PROBLEMS).sort()).toEqual(
      ["arrow", "dash", "doubleHyphen", "hyphenBullet", "jargon", "semicolon", "spacedHyphen"].sort(),
    );
    expect(Object.isFrozen(PROBLEMS)).toBe(true);
  });
});
