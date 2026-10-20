import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColour } from "./contrast.js";
import {
  colourTokensOf,
  ELEVATIONS,
  LAYERS,
  LEADING_ROLES,
  PLAYER_ROLES,
  STATUS_ROLES,
  TYPE_ROLES,
} from "./tokenRoles.js";

// tokens.css is the only source of the values (CC-314). These tests read it as text, the way a browser would, with
// the dark theme's values laid over the light ones.
const SOURCE = readFileSync(path.join(import.meta.dirname, "tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const declarations = (block) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );

const LIGHT = declarations(/^:root\s*\{([\s\S]*?)^\}/m.exec(SOURCE)[1]);
const DARK = {
  ...LIGHT,
  ...declarations(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/.exec(SOURCE)[1]),
};
const THEMES = Object.freeze({ light: LIGHT, dark: DARK });

/** A token's value with every `var()` alias followed to the end. */
const valueOf = (theme, name) => {
  const value = theme[name];
  expect(value, `${name} is missing`).toBeDefined();
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? valueOf(theme, alias[1]) : value;
};

const TEXT_ROLES = [...STATUS_ROLES, ...PLAYER_ROLES].map(({ role }) => role);

describe("tokens.css", () => {
  it.each(Object.entries(THEMES))("every role exists in both themes and passes contrast (%s)", (_, theme) => {
    const bg = valueOf(theme, "--color-bg");
    const surface = valueOf(theme, "--color-surface");
    for (const role of TEXT_ROLES) {
      const { solid, soft, on } = colourTokensOf(role);
      const [colour, pale, onColour] = [solid, soft, on].map((name) => valueOf(theme, name));
      for (const [behind, name] of [
        [bg, "--color-bg"],
        [surface, "--color-surface"],
        [pale, soft],
      ]) {
        expect(contrastRatio(colour, behind), `${solid} on ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(onColour, colour), `${on} on ${solid}`).toBeGreaterThanOrEqual(4.5);
    }
    // The focus ring is the one non-text role: 3:1 on both backgrounds (WCAG 1.4.11).
    for (const behind of [bg, surface]) {
      expect(contrastRatio(valueOf(theme, "--color-focus"), behind)).toBeGreaterThanOrEqual(3);
    }
    for (const { token } of [...TYPE_ROLES, ...LEADING_ROLES, ...ELEVATIONS, ...LAYERS]) {
      expect(theme[token], `${token} is missing`).toBeDefined();
    }
  });

  it("info is the primary colour, and the players are XP blue and accent magenta (owner, D2 and D3)", () => {
    for (const theme of Object.values(THEMES)) {
      expect(valueOf(theme, "--color-info")).toBe(valueOf(theme, "--color-primary"));
      expect(valueOf(theme, "--color-you")).toBe(valueOf(theme, "--color-xp"));
      expect(valueOf(theme, "--color-opponent")).toBe(valueOf(theme, "--color-accent"));
    }
  });

  it("each type role is one of the seven text sizes", () => {
    const sizes = new Set(["xs", "sm", "md", "lg", "xl", "2xl", "3xl"].map((size) => `var(--text-${size})`));
    for (const { token } of TYPE_ROLES) {
      expect(sizes).toContain(LIGHT[token]);
    }
  });

  it("each layer has the value it had before CC-314, so nothing stacks in a new order", () => {
    for (const { token, value } of LAYERS) {
      expect(Number(valueOf(LIGHT, token)), token).toBe(value);
    }
    const app = LAYERS.filter(({ token }) => !token.startsWith("--layer-board-")).map(({ value }) => value);
    expect(app).toEqual([...app].sort((a, b) => a - b));
  });
});

describe("parseColour", () => {
  it("reads hex and a browser's rgb() form, and refuses a see-through colour", () => {
    expect(parseColour("#0a66a8")).toEqual([10, 102, 168]);
    expect(parseColour("rgb(10, 102, 168)")).toEqual([10, 102, 168]);
    expect(parseColour("rgba(10, 102, 168, 1)")).toEqual([10, 102, 168]);
    expect(() => parseColour("rgb(10 10 25 / 55%)")).toThrow(RangeError);
    expect(() => parseColour("red")).toThrow(RangeError);
  });

  it("measures black on white as 21 and a colour on itself as 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#5b4cf0", "#5b4cf0")).toBe(1);
  });
});
