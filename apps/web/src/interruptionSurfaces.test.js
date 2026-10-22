import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SURFACE_CLASSES, SURFACE_IDS, SURFACE_OPENERS, SURFACES } from "@classicade/shared";
import { createInterruptionTracker } from "./lib/telemetry/interruptions.js";

// Every interruption names a registered surface (CC-313). The test reads the source, so a new toast, dialog or banner
// that does not is caught in the pull request that adds it, and a registered surface no code shows is caught too.
const SRC = path.dirname(fileURLToPath(import.meta.url));

/** The web app's source files that are not tests or test helpers, as [path, text]. */
function sources(folder = SRC) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sources(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)
      ? [[path.relative(SRC, full), readFileSync(full, "utf8")]]
      : [];
  });
}

/** The text of a call or element that starts at `start`, up to its closing bracket. */
function argumentsAt(text, start, open = "(", close = ")") {
  let depth = 0;
  for (let index = text.indexOf(open, start); index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    if (text[index] === close) depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

const files = sources();
const named = (pattern) => (text) => pattern.exec(text)?.[1];
const SURFACE_OPTION = named(/surface:\s*"([^"]+)"/);
const SURFACE_PROP = named(/surface="([^"]+)"/);
const HOOK = /useInterruption\(\s*"([^"]+)"/g;

/** Every place that shows something: [file, how, the surface it names or undefined]. */
const shown = files.flatMap(([file, text]) => [
  ...[...text.matchAll(/\btoasts?\.show\(/g)].map((match) => [
    file,
    "toast.show",
    SURFACE_OPTION(argumentsAt(text, match.index)),
  ]),
  ...[...text.matchAll(/<Modal\b/g)].map((match) => [
    file,
    "<Modal>",
    SURFACE_PROP(argumentsAt(text, match.index, "<", ">")),
  ]),
  ...[...text.matchAll(HOOK)].map((match) => [file, "useInterruption", match[1]]),
]);

/** The components that are interruptions themselves, each with the surfaces it must name. */
const COMPONENTS = Object.freeze({
  "components/ConnectionBanner/ConnectionBanner.jsx": ["banner.connection"],
  "components/TurnBanner/TurnBanner.jsx": ["banner.turn"],
  "components/RequestBanner/RequestBanner.jsx": ["banner.request"],
  "components/SiteRequests/SiteRequests.jsx": ["request.site", "request.challenge"],
  "components/SaveProgress/SaveProgressCard.jsx": ["card.save_progress"],
  "components/SaveProgress/StreakAtRisk.jsx": ["line.streak_at_risk"],
  "components/WakingUp/WakingUp.jsx": ["screen.waking_up"],
});

describe("interruption surfaces (CC-313)", () => {
  // AC-1 (CC-313)
  it("every interruption names a registered surface", () => {
    expect(shown.length).toBeGreaterThan(30);
    const unnamed = shown.filter(([, , surface]) => !SURFACE_IDS.includes(/** @type {string} */ (surface)));
    expect(unnamed.map(([file, how, surface]) => `${file}: ${how} ${surface ?? "with no surface"}`)).toEqual(
      [],
    );

    Object.entries(COMPONENTS).forEach(([file, surfaces]) => {
      const hooks = shown.filter(
        ([where, how]) => where === path.normalize(file) && how === "useInterruption",
      );
      expect({ file, surfaces: hooks.map(([, , surface]) => surface).sort() }).toEqual({
        file,
        surfaces: [...surfaces].sort(),
      });
    });

    const used = new Set(shown.map(([, , surface]) => surface));
    expect(SURFACE_IDS.filter((id) => !used.has(id))).toEqual([]);
  });

  it("every surface is written once, as kind.what, with its ticket", () => {
    expect(new Set(SURFACE_IDS).size).toBe(SURFACE_IDS.length);
    SURFACES.forEach((surface) => {
      expect(surface.id).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(surface.id.startsWith(`${surface.kind}.`)).toBe(true);
      expect(surface.ticket).toMatch(/^CC-\d{3,}$/);
    });
  });

  // AC-5 (CC-313)
  it("no optional blocking surface opens during play", () => {
    const optionalBlocking = SURFACES.filter(
      (surface) => surface.class === SURFACE_CLASSES.OPTIONAL && surface.blocking,
    );
    // Only the player's own press opens one, so none can open on their own in the middle of a game.
    expect(optionalBlocking.map(({ id, opens }) => [id, opens])).toEqual(
      optionalBlocking.map(({ id }) => [id, SURFACE_OPENERS.PLAYER]),
    );

    // And a code path that would open one by the system during play fails at once.
    const tracker = createInterruptionTracker({ telemetry: { track: () => {} }, now: () => 0, strict: true });
    tracker.notePhase("my-turn", "chess");
    optionalBlocking.forEach(({ id }) => {
      expect(() => tracker.open(id, { trigger: SURFACE_OPENERS.SYSTEM })).toThrow(
        /may not open during a game/,
      );
      expect(() => tracker.open(id)).not.toThrow();
    });
    tracker.notePhase("finished", "chess");
    expect(() => tracker.open(optionalBlocking[0].id, { trigger: SURFACE_OPENERS.SYSTEM })).not.toThrow();
  });
});
