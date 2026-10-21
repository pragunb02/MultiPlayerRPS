import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

// The layout probe (CC-154): looks at what a page shows now and reports, in one line each, what a person would see
// as broken. Text cut off, something past the edge of the screen or a page that scrolls sideways, two controls on
// top of each other, a control covered by something else that takes the press, a tap target under 24 px, and text
// that fails contrast (axe's colour rules, as in CC-183). It reads the DOM and the layout, never pixels, so it is as
// steady as any other browser test and can be a required check (CC-154 D2).
//
// The API, for every spec that wants it (CC-327, CC-331 and the rest import it instead of writing their own). It is
// kept stable: a change to these names or shapes is a change to every spec that uses them.
//
//   const findings = await probeViewports(page, { screen: "home" });  // every size in VIEWPORTS, light and dark
//   expectNoLayoutProblems(findings, { knownFailures });               // fails with one line per finding
//
//   findLayoutProblems(page, { screen, kinds?, colorScheme? })  the findings at the page's current size only
//   inflateNumbers(page)          big-number stress: every number on the page becomes six digits
//   formatFinding(finding)        the one line a failure prints
//   sortFindings(findings, marks) the findings known failures cover, and the rest (expectNoLayoutProblems uses it)
//   VIEWPORTS, KINDS, MIN_TARGET_PX
//
// Stress names and text are in personas.js (STRESS, longNameAccount). Anything not exported here may change.
//
// What counts as a finding, and what does not:
//   clipped       text drawn past the edge of a box that cuts it (overflow hidden or clip, a line clamp). An
//                 ellipsis is allowed only when the whole text is in the accessible name, not a title (CC-154 D4).
//                 Text in a box that scrolls is not clipped.
//   overflow      anything seen past the left or right edge of the screen (the outermost box only). Wholly off the
//                 left edge (a skip link until focused) is the off-screen pattern, not a finding.
//   page-scroll   the page is wider than the screen.
//   overlap       two controls, or a control and text not its own, overlap by more than 1 px each way.
//   covered       the press at the middle of a control goes to something else. Under an open modal dialog the page
//                 is inert by contract, so only the dialog is checked; anything with pointer-events: none (the
//                 toast column, effects) lets presses through and so never covers.
//   small-target  under 24 × 24 px with another target within 12 px of its centre, unless it is a link in a line of
//                 text (WCAG 2.2 2.5.8).
//   contrast      axe's color-contrast and link-in-text-block rules, serious or critical (CC-183's colour rules).
// Hidden things are skipped: not laid out, visibility hidden, opacity 0, visually hidden (the screen reader only
// pattern), and aria-hidden art with pointer-events: none.

/**
 * The sizes every screen is checked at, in CSS px: phones from the smallest WCAG asks for (320, reflow 1.4.10) to an
 * iPhone, a tablet each way up, a laptop, and 200 % zoom of the laptop. A browser zoomed to 200 % lays the page out
 * in half the CSS px, so 1280 × 720 at 200 % is a 640 × 360 viewport (CC-154 D1, WCAG 1.4.4).
 */
export const VIEWPORTS = Object.freeze(
  [
    { name: "320", width: 320, height: 640 },
    { name: "360", width: 360, height: 800 },
    { name: "390", width: 390, height: 844 },
    { name: "768", width: 768, height: 1024 },
    { name: "1024", width: 1024, height: 768 },
    { name: "1280", width: 1280, height: 720 },
    { name: "200% zoom", width: 640, height: 360 },
  ].map((viewport) => Object.freeze(viewport)),
);

/** The kinds of finding, in the order a report lists them. */
export const KINDS = Object.freeze([
  "clipped",
  "overflow",
  "page-scroll",
  "overlap",
  "covered",
  "small-target",
  "contrast",
]);

/** WCAG 2.2 2.5.8 Target Size (Minimum): 24 by 24 CSS px, or 24 px of space around a smaller target. */
export const MIN_TARGET_PX = 24;

/** axe's colour rules, the ones CC-183 runs in the dark theme too. */
const CONTRAST_RULES = ["color-contrast", "link-in-text-block"];
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Box
 * @typedef {{ tag: string, role: string, name: string, className: string, box: Box }} Described
 * @typedef {{ name: string, width: number, height: number }} Viewport
 * @typedef {{
 *   kind: string, screen: string, viewport: string, colorScheme: string,
 *   element: Described, other?: Described, detail: string,
 * }} Finding
 * @typedef {{ kind: string, element: RegExp, screen?: RegExp, viewport?: string, ticket: string }} KnownFailure
 */

/**
 * The findings on the page as it is now, at its current size. Motion is reduced first, so nothing is judged half way
 * through an animation, and the page is given two frames to settle.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ screen: string, kinds?: readonly string[], viewport?: string, colorScheme?: "light" | "dark" }} options
 *   `screen` names the screen and state in every line; `kinds` limits the checks (all of KINDS by default);
 *   `viewport` is the name printed for the size (the width × height by default); `colorScheme` is the theme to
 *   check in (the page's own by default)
 * @returns {Promise<Finding[]>}
 */
export async function findLayoutProblems(page, { screen, kinds = KINDS, viewport, colorScheme }) {
  await page.emulateMedia({ reducedMotion: "reduce", ...(colorScheme ? { colorScheme } : {}) });
  await settle(page);
  const size = page.viewportSize();
  const context = {
    screen,
    viewport: viewport ?? `${size.width}×${size.height}`,
    colorScheme:
      colorScheme ??
      (await page.evaluate(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"))),
  };
  const layoutKinds = kinds.filter((kind) => kind !== "contrast");
  const raw =
    layoutKinds.length > 0
      ? await page.evaluate(scanLayout, { kinds: layoutKinds, minTarget: MIN_TARGET_PX })
      : [];
  if (layoutKinds.includes("covered")) raw.push(...(await coveredBelowTheFold(page)));
  const findings = raw.map((finding) => ({ ...finding, ...context }));
  if (kinds.includes("contrast")) findings.push(...(await contrastFindings(page, context)));
  return dedupe(findings);
}

/**
 * The findings at every viewport (VIEWPORTS by default), in light and dark for contrast and in the page's own theme
 * for the layout. The page is put back at its own size and theme afterwards.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{
 *   screen: string, viewports?: readonly Viewport[], kinds?: readonly string[],
 *   colorSchemes?: readonly ("light" | "dark")[], prepare?: (page: import("@playwright/test").Page) => Promise<void>,
 * }} options  `prepare` runs after each resize and before the checks, for a screen that must be opened again
 *   (a menu that closes when the size changes, for example)
 * @returns {Promise<Finding[]>}
 */
export async function probeViewports(
  page,
  { screen, viewports = VIEWPORTS, kinds = KINDS, colorSchemes = ["light", "dark"], prepare },
) {
  const original = page.viewportSize();
  const findings = [];
  try {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await prepare?.(page);
      const layoutKinds = kinds.filter((kind) => kind !== "contrast");
      if (layoutKinds.length > 0) {
        findings.push(
          ...(await findLayoutProblems(page, {
            screen,
            kinds: layoutKinds,
            viewport: viewport.name,
            colorScheme: colorSchemes[0],
          })),
        );
      }
      if (kinds.includes("contrast")) {
        for (const colorScheme of colorSchemes) {
          findings.push(
            ...(await findLayoutProblems(page, {
              screen,
              kinds: ["contrast"],
              viewport: viewport.name,
              colorScheme,
            })),
          );
        }
      }
    }
  } finally {
    await page.setViewportSize(original);
    await page.emulateMedia({ colorScheme: null, reducedMotion: null });
  }
  return findings;
}

/**
 * Fails, with one line per finding, when there is any finding that no known failure covers. A known failure is a
 * finding we have a ticket for and have not fixed yet (CC-154 D3): its kind, a pattern for its elements (the
 * element, then " and " and the other element when there is one, as formatFinding writes them), optionally the
 * screen and viewport, and the ticket. The findings a mark covered are returned, and the marks that covered none
 * (fixed, or not reached on this browser), so a spec can note them.
 *
 * @param {Finding[]} findings
 * @param {{ knownFailures?: readonly KnownFailure[] }} [options]
 * @returns {{ known: { finding: Finding, ticket: string }[], unmatched: KnownFailure[] }}
 */
export function expectNoLayoutProblems(findings, { knownFailures = [] } = {}) {
  const { problems, known, unmatched } = sortFindings(findings, knownFailures);
  expect(problems.map(formatFinding), "layout probe findings (CC-154)").toEqual([]);
  return { known, unmatched };
}

/**
 * Splits findings into the ones a known failure covers and the rest.
 *
 * @param {Finding[]} findings
 * @param {readonly KnownFailure[]} knownFailures
 * @returns {{ problems: Finding[], known: { finding: Finding, ticket: string }[], unmatched: KnownFailure[] }}
 */
export function sortFindings(findings, knownFailures) {
  const problems = [];
  const known = [];
  const used = new Set();
  for (const finding of findings) {
    const mark = knownFailures.find((candidate) => matches(candidate, finding));
    if (mark === undefined) {
      problems.push(finding);
    } else {
      used.add(mark);
      known.push({ finding, ticket: mark.ticket });
    }
  }
  return { problems, known, unmatched: knownFailures.filter((mark) => !used.has(mark)) };
}

const matches = (mark, finding) =>
  mark.kind === finding.kind &&
  mark.element.test(
    `${describeElement(finding.element)}${finding.other ? ` and ${describeElement(finding.other)}` : ""}`,
  ) &&
  (mark.screen === undefined || mark.screen.test(finding.screen)) &&
  (mark.viewport === undefined || mark.viewport === finding.viewport);

/**
 * The one line a finding prints: the kind, the screen, the viewport and theme, the element and its box, and the
 * other element and its box when there is one (CC-154 AC-6).
 *
 * @param {Finding} finding
 * @returns {string}
 */
export function formatFinding({ kind, screen, viewport, colorScheme, element, other, detail }) {
  const against = other ? ` and ${describeElement(other)} ${formatBox(other.box)}` : "";
  return `${kind} on ${screen} at ${viewport} (${colorScheme}): ${describeElement(element)} ${formatBox(element.box)}${against}: ${detail}`;
}

/**
 * An element in a few words: tag, role, name and first class, such as `<button role=button "Rock" .choice>`.
 *
 * @param {Described} element
 * @returns {string}
 */
export function describeElement({ tag, role, name, className }) {
  const roleText = role && role !== tag ? ` role=${role}` : "";
  const nameText = name ? ` "${name}"` : "";
  const classText = className ? ` .${className}` : "";
  return `<${tag}${roleText}${nameText}${classText}>`;
}

/** @param {Box} box */
export const formatBox = ({ x, y, width, height }) => `at ${x},${y} ${width}×${height}`;

/**
 * Big-number stress: every piece of text on the page that is only a number (a level, an XP total, a rank, a score,
 * a move number such as "10.") becomes six digits, as a player deep into the game would see. React puts the real
 * number back on its next render, so probe straight after.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<number>} how many numbers were changed
 */
export async function inflateNumbers(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let changed = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const match = /^(\s*[+#-]?)(\d[\d,]*)(\.?\s*)$/.exec(node.data);
      if (match === null || node.parentElement?.closest("script, style, option, textarea")) continue;
      node.data = `${match[1]}888,888${match[3]}`;
      changed += 1;
    }
    return changed;
  });
}

/** Two animation frames and the fonts, so a resize or a theme change has been laid out. */
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }),
  );
}

/**
 * A covered control is found by asking the page what is at its centre, which only works for what is on the screen.
 * A bar fixed to the bottom covers the last controls only once the page is scrolled down, so the page is scrolled
 * one screen at a time and asked again, then put back where it was.
 */
async function coveredBelowTheFold(page) {
  const { scrollHeight, innerHeight, scrollY } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight,
    scrollY,
  }));
  const found = [];
  for (let top = innerHeight; top < scrollHeight; top += innerHeight) {
    await page.evaluate(
      (y) => window.scrollTo({ top: y, behavior: "instant" }),
      Math.min(top, scrollHeight - innerHeight),
    );
    await settle(page);
    found.push(...(await page.evaluate(scanLayout, { kinds: ["covered"], minTarget: MIN_TARGET_PX })));
  }
  if (scrollHeight > innerHeight) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), scrollY);
  }
  return found;
}

/** axe's colour rules on the page now: one finding per element that fails, serious or critical only. */
async function contrastFindings(page, context) {
  const { violations } = await new AxeBuilder({ page }).withRules(CONTRAST_RULES).analyze();
  const findings = [];
  for (const violation of violations.filter((v) => FAILING_IMPACTS.has(v.impact))) {
    for (const node of violation.nodes) {
      const target = node.target.join(" ");
      const element = await page.evaluate(describeSelector, target).catch(() => ({
        tag: "?",
        role: "",
        name: target,
        className: "",
        box: { x: 0, y: 0, width: 0, height: 0 },
      }));
      const message = (node.any[0]?.message ?? node.failureSummary ?? violation.help).split("\n")[0];
      findings.push({ kind: "contrast", ...context, element, detail: `${violation.id}: ${message}` });
    }
  }
  return findings;
}

/** In the page: describes the element axe's selector points to, the same way scanLayout does. */
function describeSelector(selector) {
  const element = document.querySelector(selector);
  const rect = element.getBoundingClientRect();
  const text = (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? "",
    name: text.length > 40 ? `${text.slice(0, 39)}…` : text,
    className: (typeof element.className === "string" ? element.className : "").split(/\s+/)[0] ?? "",
    box: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

/** One finding per kind and element pair: a long text node can be clipped on every line, and that is one problem. */
function dedupe(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.kind}|${finding.viewport}|${finding.colorScheme}|${describeElement(finding.element)}|${formatBox(finding.element.box)}|${finding.other ? describeElement(finding.other) : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Runs in the page. Walks the visible DOM and returns the layout findings of the asked kinds, without screen or
 * viewport (the caller adds those). Must not use anything from outside its own body: Playwright sends its source.
 *
 * @param {{ kinds: string[], minTarget: number }} options
 */
function scanLayout({ kinds, minTarget }) {
  const want = new Set(kinds);
  const findings = [];
  const SLACK = 1; // px: sub-pixel rounding is not a finding
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  const round = (n) => Math.round(n);
  const boxOf = (r) => ({
    x: round(r.left),
    y: round(r.top),
    width: round(r.right - r.left),
    height: round(r.bottom - r.top),
  });
  const styles = new Map();
  const style = (element) => {
    if (!styles.has(element)) styles.set(element, getComputedStyle(element));
    return styles.get(element);
  };
  const IMPLICIT_ROLES = {
    a: "link",
    button: "button",
    select: "combobox",
    textarea: "textbox",
    summary: "button",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    li: "listitem",
    img: "img",
    nav: "navigation",
    main: "main",
    header: "banner",
    dialog: "dialog",
  };
  const roleOf = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const type = element.getAttribute("type") ?? "text";
      return (
        { checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button" }[type] ??
        "textbox"
      );
    }
    return IMPLICIT_ROLES[tag] ?? "";
  };
  const nameOf = (element) => {
    const labelled = element.getAttribute("aria-labelledby");
    const fromIds = labelled
      ? labelled
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      : "";
    const text = (
      element.getAttribute("aria-label") ||
      fromIds ||
      element.labels?.[0]?.textContent ||
      element.textContent ||
      element.getAttribute("placeholder") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  };
  const describe = (element, rect = element.getBoundingClientRect()) => ({
    tag: element.tagName.toLowerCase(),
    role: roleOf(element),
    name: nameOf(element),
    className:
      (typeof element.className === "string"
        ? element.className
        : (element.getAttribute("class") ?? "")
      ).split(/\s+/)[0] ?? "",
    box: boxOf(rect),
  });
  const intersect = (a, b) => ({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });
  const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  const overlapOf = (a, b) => {
    const r = intersect(a, b);
    return { width: r.right - r.left, height: r.bottom - r.top };
  };

  /** Shown at all: laid out, not hidden by CSS, not see-through. */
  const shown = (element) => {
    if (
      element.checkVisibility &&
      !element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
    )
      return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style(element).visibility !== "hidden";
  };
  /** Hidden from the eye but kept for screen readers (the visually-hidden pattern): 1 px boxes, clip, clip-path. */
  const visuallyHidden = (element) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const s = style(node);
      const rect = node.getBoundingClientRect();
      if (s.clip !== "auto" && s.clip !== "" && s.position === "absolute") return true;
      if (/inset\(\s*50%/.test(s.clipPath)) return true;
      if (rect.width <= 1 && rect.height <= 1 && s.overflow !== "visible") return true;
    }
    return false;
  };
  /** Art and effects that never take a press and say nothing (aria-hidden, pointer-events: none). */
  const decoration = (element) =>
    element.closest('[aria-hidden="true"]') !== null && style(element).pointerEvents === "none";

  /** The box the element's content is drawn in, minus borders and scrollbars. */
  const paddingBox = (element) => {
    const r = element.getBoundingClientRect();
    const left = r.left + element.clientLeft;
    const top = r.top + element.clientTop;
    return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
  };
  const clipsX = (s) => ["hidden", "clip"].includes(s.overflowX) || /paint|strict|content/.test(s.contain);
  const clipsY = (s) => ["hidden", "clip"].includes(s.overflowY) || /paint|strict|content/.test(s.contain);
  const scrollsX = (s) => ["auto", "scroll"].includes(s.overflowX);
  const scrollsY = (s) => ["auto", "scroll"].includes(s.overflowY);
  /** Whether `element` is the containing block for a positioned descendant (CSS 2 §10.1 and transforms). */
  const holdsPositioned = (s, fixed) =>
    (!fixed && s.position !== "static") ||
    s.transform !== "none" ||
    s.filter !== "none" ||
    s.perspective !== "none" ||
    /paint|layout|strict|content/.test(s.contain);
  /**
   * The ancestors whose overflow can cut `element`: its containing block chain up to, not including, the body. An
   * absolutely positioned box escapes the overflow of the static boxes between it and its containing block, and a
   * fixed box escapes all of them unless a transform holds it.
   */
  const clippers = (element) => {
    const chain = [];
    let node = element;
    while (node && node !== document.body && node !== document.documentElement) {
      const position = style(node).position;
      let parent = node.parentElement;
      if (position === "absolute" || position === "fixed") {
        while (parent && parent !== document.body && !holdsPositioned(style(parent), position === "fixed")) {
          parent = parent.parentElement;
        }
      }
      if (!parent || parent === document.body || parent === document.documentElement) break;
      chain.push(parent);
      node = parent;
    }
    return chain;
  };
  /** The part of `rect` the eye can see after every ancestor's overflow, or null when an ancestor scrolls it away. */
  const visiblePart = (element, rect) => {
    let visible = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (const ancestor of clippers(element)) {
      const s = style(ancestor);
      const box = paddingBox(ancestor);
      if (clipsX(s) || scrollsX(s))
        visible = {
          ...visible,
          left: Math.max(visible.left, box.left),
          right: Math.min(visible.right, box.right),
        };
      if (clipsY(s) || scrollsY(s))
        visible = {
          ...visible,
          top: Math.max(visible.top, box.top),
          bottom: Math.min(visible.bottom, box.bottom),
        };
    }
    return visible;
  };

  // The open modal dialog, if any: the page behind it is inert by contract (CONTRACT.md, Dialog), so it is covered
  // on purpose and only the dialog is checked for overlap and covered controls.
  const modal = [
    ...document.querySelectorAll(
      'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
    ),
  ]
    .filter(shown)
    .at(-1);
  const inScope = (element) =>
    (modal ? modal.contains(element) : true) && element.closest("[inert]") === null;

  const INTERACTIVE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="slider"]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(",");
  // A control drawn by its label (a native radio made invisible under a styled label) is pressed through its label,
  // so the label stands in for it.
  const controls = [...document.querySelectorAll(INTERACTIVE)].filter(
    (element) =>
      shown(element) &&
      !visuallyHidden(element) &&
      style(element).pointerEvents !== "none" &&
      inScope(element),
  );
  // A control inside another control (an icon button's own svg wrapped in a span with tabindex) is the same target.
  const targets = controls.filter(
    (element) => !controls.some((other) => other !== element && other.contains(element)),
  );

  const texts = [];
  {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || node.data.trim() === "") continue;
      if (parent.closest("script, style, noscript, template, option, textarea, select")) continue;
      if (!shown(parent) || visuallyHidden(parent) || decoration(parent)) continue;
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;
      texts.push({ node, parent, rects });
    }
  }

  // 1. Clipped text: drawn past the edge of an ancestor that cuts its overflow. An ellipsis is allowed only when the
  // whole text is in the accessible name (an aria-label, aria-labelledby, or a visually hidden copy beside it), never
  // a title (CC-154 D4).
  if (want.has("clipped")) {
    const fullTextReachable = (parent, text) => {
      for (let node = parent; node && node !== document.body; node = node.parentElement) {
        if ((node.getAttribute("aria-label") ?? "").includes(text)) return true;
        const labelled = node.getAttribute("aria-labelledby");
        if (
          labelled &&
          labelled
            .split(/\s+/)
            .some(
              (id) =>
                document.getElementById(id) !== node &&
                (document.getElementById(id)?.textContent ?? "").includes(text),
            )
        )
          return true;
        const copies = [...node.querySelectorAll("*")].filter(
          (copy) => copy !== parent && !copy.contains(parent) && visuallyHidden(copy),
        );
        if (copies.some((copy) => (copy.textContent ?? "").includes(text))) return true;
      }
      return false;
    };
    for (const { node, parent, rects } of texts) {
      for (const ancestor of [parent, ...clippers(parent)]) {
        const s = style(ancestor);
        // Text past the edge of a box that scrolls is reached by scrolling it, not cut off.
        if (ancestor !== parent && (scrollsX(s) || scrollsY(s))) break;
        const x = clipsX(s);
        const y = clipsY(s);
        const lineClamp = s.webkitLineClamp && s.webkitLineClamp !== "none";
        if (!x && !y && !lineClamp) continue;
        const box = paddingBox(ancestor);
        const out = rects.some(
          (r) =>
            (x && (r.left < box.left - SLACK || r.right > box.right + SLACK)) ||
            ((y || lineClamp) && (r.top < box.top - SLACK || r.bottom > box.bottom + SLACK)),
        );
        if (!out) continue;
        const text = node.data.replace(/\s+/g, " ").trim();
        const ellipsis =
          s.textOverflow === "ellipsis" || style(parent).textOverflow === "ellipsis" || lineClamp;
        if (ellipsis && fullTextReachable(parent, text)) break;
        findings.push({
          kind: "clipped",
          element: describe(parent),
          other: ancestor === parent ? undefined : describe(ancestor),
          detail: `"${text.length > 40 ? `${text.slice(0, 39)}…` : text}" is cut off${ellipsis ? " with an ellipsis, and the whole text is not in the accessible name" : ""}`,
        });
        break;
      }
    }
  }

  // 2. Overflow: anything the eye can see past the left or right edge of the screen, outermost box only.
  if (want.has("overflow")) {
    const reported = [];
    for (const element of document.querySelectorAll("body *")) {
      if (reported.some((outer) => outer.contains(element))) continue;
      if (!shown(element) || visuallyHidden(element) || decoration(element)) continue;
      const rect = element.getBoundingClientRect();
      const visible = visiblePart(element, rect);
      if (visible.right - visible.left <= 0 || visible.bottom - visible.top <= 0) continue;
      // Wholly before the left edge is the off-screen pattern (a skip link until it has focus): nobody sees it and
      // the page does not scroll to it. Partly before the edge is cut off.
      if (visible.right <= 0) continue;
      const past =
        visible.right > viewportWidth + SLACK
          ? `ends ${round(visible.right - viewportWidth)} px past the right edge`
          : visible.left < -SLACK
            ? `starts ${round(-visible.left)} px before the left edge`
            : "";
      if (past === "") continue;
      reported.push(element);
      findings.push({
        kind: "overflow",
        element: describe(element, rect),
        detail: `${past} of a ${viewportWidth} px screen`,
      });
    }
  }

  // 3. The page scrolls sideways.
  if (want.has("page-scroll")) {
    const { scrollWidth } = document.documentElement;
    if (scrollWidth > viewportWidth + SLACK) {
      findings.push({
        kind: "page-scroll",
        // The page itself. Its text would be every word on it; the overflow findings name what stands past the edge.
        element: { ...describe(document.documentElement), name: "" },
        detail: `the page is ${scrollWidth} px wide in a ${viewportWidth} px screen, so it scrolls sideways`,
      });
    }
  }

  // 4. Overlap: two controls, or a control and text that is not its own, drawn on top of each other by more than
  // 1 px each way. One inside the other is not an overlap.
  if (want.has("overlap")) {
    const boxes = targets.map((element) => ({ element, rect: element.getBoundingClientRect() }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const o = overlapOf(a.rect, b.rect);
        if (o.width > SLACK && o.height > SLACK) {
          findings.push({
            kind: "overlap",
            element: describe(a.element, a.rect),
            other: describe(b.element, b.rect),
            detail: `two controls overlap by ${round(o.width)}×${round(o.height)} px`,
          });
        }
      }
    }
    for (const { node, parent, rects } of texts) {
      if (!inScope(parent)) continue;
      for (const { element, rect } of boxes) {
        if (element.contains(node) || parent.contains(element)) continue;
        // A label's own text sits on its control's box when the control is drawn inside it.
        if (element.labels && [...element.labels].some((label) => label.contains(node))) continue;
        const hit = rects.find((r) => {
          const o = overlapOf(r, rect);
          return o.width > SLACK && o.height > SLACK;
        });
        if (hit) {
          const o = overlapOf(hit, rect);
          findings.push({
            kind: "overlap",
            element: describe(element, rect),
            other: describe(parent),
            detail: `text "${node.data.trim().slice(0, 30)}" overlaps the control by ${round(o.width)}×${round(o.height)} px`,
          });
          break;
        }
      }
    }
  }

  // 5. Covered: what takes a press at the middle of a control's visible part is not the control. Only controls on
  // the screen now can be asked (the caller scrolls the page for the rest).
  if (want.has("covered")) {
    for (const element of targets) {
      const visible = visiblePart(element, element.getBoundingClientRect());
      const onScreen = intersect(visible, { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight });
      if (area(onScreen) <= 0) continue;
      const x = (onScreen.left + onScreen.right) / 2;
      const y = (onScreen.top + onScreen.bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit === null || element.contains(hit)) continue;
      if (element.labels && [...element.labels].some((label) => label.contains(hit))) continue;
      if (hit.tagName === "LABEL" && hit.control === element) continue;
      findings.push({
        kind: "covered",
        element: describe(element),
        other: describe(hit),
        detail: `the press at ${round(x)},${round(y)} goes to the other element`,
      });
    }
  }

  // 6. Small targets: under 24 × 24 px, unless a 24 px circle on its centre touches no other target (the spacing
  // exception) or it is a link inside a line of text (the inline exception), WCAG 2.2 2.5.8.
  if (want.has("small-target")) {
    const boxes = targets.map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
    const distanceToRect = (p, r) =>
      Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
    const small = (r) => r.width < minTarget - 0.5 || r.height < minTarget - 0.5;
    for (const { element, rect } of boxes) {
      if (!small(rect)) continue;
      const s = style(element);
      const inSentence =
        s.display === "inline" &&
        [...(element.parentElement?.childNodes ?? [])].some(
          (child) => child.nodeType === Node.TEXT_NODE && child.data.trim() !== "",
        );
      if (inSentence) continue;
      const c = centre(rect);
      const crowded = boxes.find(({ element: other, rect: r }) => {
        if (other === element) return false;
        return small(r)
          ? Math.hypot(centre(r).x - c.x, centre(r).y - c.y) < minTarget
          : distanceToRect(c, r) < minTarget / 2;
      });
      if (crowded === undefined) continue;
      findings.push({
        kind: "small-target",
        element: describe(element, rect),
        other: describe(crowded.element, crowded.rect),
        detail: `${round(rect.width)}×${round(rect.height)} px is under ${minTarget}×${minTarget} px with another target within ${minTarget / 2} px of its centre`,
      });
    }
  }

  return findings;
}
