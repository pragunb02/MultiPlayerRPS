import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../styles/contrast.js";
import { colourTokensOf, PLAYER_ROLES, STATUS_ROLES } from "../../styles/tokenRoles.js";
import { EFFECTS, THEMEABLE_TOKENS } from "../registry.js";

// Event themes (CC-328, ADR-075): a theme changes decoration tokens and nothing else, so every screen stays as
// readable as on any other day, and no file outside apps/web/src/effects/ knows a theme exists.
const HERE = import.meta.dirname;
const WEB_SRC = path.resolve(HERE, "../..");
const EFFECTS_FOLDER = path.resolve(HERE, "..");
const THEMES = EFFECTS.filter(({ kind }) => kind === "theme");
const DARK_QUERY = "(prefers-color-scheme: dark)";
const SVG_BUDGET_BYTES = 4 * 1024;

const read = (file) => readFileSync(file, "utf8");
const uncommented = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The light and dark token values of the token files, the dark laid over the light, as a browser reads them. */
function tokenThemes() {
  const folder = path.join(WEB_SRC, "styles/tokens");
  const light = {};
  const dark = {};
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".css"))) {
    postcss.parse(uncommented(read(path.join(folder, file)))).walkDecls(/^--/, (decl) => {
      const media = decl.parent.parent?.type === "atrule" ? decl.parent.parent.params : undefined;
      if (media === undefined) light[decl.prop] = decl.value.trim();
      if (media === DARK_QUERY) dark[decl.prop] = decl.value.trim();
    });
  }
  return { light, dark: { ...light, ...dark } };
}

/** A theme's overrides, light and dark, read from its CSS module, with every rule it breaks. */
function themeCss(theme) {
  const file = path.join(HERE, `${theme.name.replace(/_(\d+)$/, "$1")}.module.css`);
  const root = postcss.parse(read(file));
  const selector = `:root[data-event-theme="${theme.name}"]`;
  const problems = [];
  const light = {};
  const dark = {};
  root.walkAtRules((rule) => {
    if (rule.name !== "media" || rule.params !== DARK_QUERY) problems.push(`@${rule.name} ${rule.params}`);
  });
  root.walkRules((rule) => {
    if (rule.selector !== selector) problems.push(`the selector ${rule.selector}`);
    const inDark = rule.parent.type === "atrule";
    rule.walkDecls((decl) => {
      if (!THEMEABLE_TOKENS.includes(decl.prop)) problems.push(`the property ${decl.prop}`);
      (inDark ? dark : light)[decl.prop] = decl.value.trim();
    });
  });
  return { file, problems, light, dark };
}

const valueOf = (theme, name) => {
  const value = theme[name];
  const alias = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return alias ? valueOf(theme, alias[1]) : value;
};
const stopsOf = (gradient) => gradient.match(/#[0-9a-f]{6}/gi);

describe("event themes (CC-328)", () => {
  it("themes change decoration tokens only and keep contrast", () => {
    const tokens = tokenThemes();
    for (const theme of THEMES) {
      const css = themeCss(theme);
      expect(css.problems, `${css.file} may only set THEMEABLE_TOKENS under its own selector`).toEqual([]);
      // Light and dark both written, so the theme never shows its light values on a dark page.
      expect(Object.keys(css.light).length, theme.name).toBeGreaterThan(0);
      expect(Object.keys(css.dark), theme.name).toEqual(
        expect.arrayContaining(["--gradient-hero", "--grid-line", "--glow-primary"]),
      );

      for (const [mode, base, overrides] of [
        ["light", tokens.light, css.light],
        ["dark", tokens.dark, { ...css.light, ...css.dark }],
      ]) {
        const page = { ...base, ...overrides };
        const at = `${theme.name}, ${mode}`;
        // Every role pair of the contract, as tokens.test.js checks it without a theme.
        for (const { role } of [...STATUS_ROLES, ...PLAYER_ROLES]) {
          const { solid, soft, on } = colourTokensOf(role);
          const [colour, pale, onColour] = [solid, soft, on].map((name) => valueOf(page, name));
          for (const behind of [valueOf(page, "--color-bg"), valueOf(page, "--color-surface"), pale]) {
            expect(contrastRatio(colour, behind), `${at}: ${solid}`).toBeGreaterThanOrEqual(4.5);
          }
          expect(contrastRatio(onColour, colour), `${at}: ${on}`).toBeGreaterThanOrEqual(4.5);
        }
        // The hero: white text and its focus ring on every stop of the theme's gradient.
        for (const stop of stopsOf(page["--gradient-hero"])) {
          expect(
            contrastRatio(valueOf(page, "--color-on-hero"), stop),
            `${at}: text on ${stop}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrastRatio(valueOf(page, "--color-focus-on-hero"), stop),
            `${at}: focus ring on ${stop}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }

      // The ambient picture is a still SVG of ours, beside the theme, within its budget.
      const ambient = /^url\("\.\/([\w-]+\.svg)"\)$/.exec(css.light["--event-ambient"])?.[1];
      expect(ambient, `${theme.name}: --event-ambient is a url() to an SVG beside it`).toBeDefined();
      const svg = read(path.join(HERE, ambient));
      expect(statSync(path.join(HERE, ambient)).size, ambient).toBeLessThanOrEqual(SVG_BUDGET_BYTES);
      expect(svg, `${ambient} is still: no animation`).not.toMatch(/<animate|<set\b|@keyframes|<script/);
      expect(svg, `${ambient} loads nothing`).not.toMatch(/href=|url\(/);
    }
  });

  it("each theme module brings its CSS and only its CSS", () => {
    const cssFiles = readdirSync(HERE).filter((file) => file.endsWith(".css"));
    expect(cssFiles.sort()).toEqual(
      THEMES.map(({ name }) => `${name.replace(/_(\d+)$/, "$1")}.module.css`).sort(),
    );
    for (const file of cssFiles) {
      const module = read(path.join(HERE, file.replace(".module.css", ".js")));
      expect(module, file).toContain(`import "./${file}";`);
    }
  });

  it("no component has theme code", () => {
    const files = (folder) =>
      readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) return full === EFFECTS_FOLDER ? [] : files(full);
        return /\.(m?js|jsx|css)$/.test(entry.name) ? [full] : [];
      });
    const names = THEMES.map(({ name }) => name);
    const INTERNAL = /["']([^"']*effects\/(?:scenes|themes)\/[^"']*|[^"']*effects\/particles(?:\.js)?)["']/g;
    const found = files(WEB_SRC).flatMap((full) => {
      const file = path.relative(WEB_SRC, full);
      const text = read(full);
      return [
        // A theme's own name, not a longer word around it such as its flag's name.
        ...names
          .filter((name) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text))
          .map((name) => `${file} names the theme ${name}`),
        ...(text.includes("data-event-theme") ? [`${file} styles data-event-theme`] : []),
        ...[...text.matchAll(INTERNAL)].map(([, target]) => `${file} imports ${target}`),
      ];
    });

    expect(found).toEqual([]);
  });
});
