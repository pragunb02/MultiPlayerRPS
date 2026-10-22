import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FRIEND_LINK_MAKER_NAME } from "@classicade/shared";
import * as challengeCopy from "./components/Challenges/challengeCopy.js";
import * as feedbackText from "./components/Feedback/feedbackText.js";
import * as friendsCopy from "./components/Friends/friendsCopy.js";
import * as profileCopy from "./components/Profile/profileCopy.js";
import * as reportText from "./components/Report/reportText.js";
import * as ageCopy from "./components/YearSelect/ageCopy.js";
import { challengeText, dailyPuzzleText, friendLinkText, inviteText } from "./lib/shareText.js";

// Hinglish speaks to the player as "tum", never "aap" (owner, 2026-10-20, CC-217; CONTRACT section 7, C9). This is
// the one test of that rule for the whole app (CC-351, check A5 of the clarity audit). It replaces the copies that
// each copy module's own test used to carry: a new Hinglish line is checked here without a test of its own.
//
// It reads the app two ways:
//
// 1. Every source file under apps/web/src, as text with its comments removed, so a line written inline in a page
//    (`<span lang="hi-Latn">`, PrivacySettings.jsx) or in a template is read too.
// 2. Every Hinglish line the copy modules make at run time, names and games filled in, so a line built from parts
//    is read whole, and each module that speaks to the player is seen to use "tum" at least once.

/** The polite forms the app never uses: "aap" and its forms, and the polite commands and questions. */
const AAP = /\b(aap|aapka|aapke|aapki|aapko|aapne|kijiye|karein|dijiye)\b|(ein|ijiye)\?/i;
/** "tum" and its forms. */
const TUM = /\b(tum|tumhe|tumhen|tumko|tumne|tumhara|tumhare|tumhari)\b/i;

const SRC = dirname(fileURLToPath(import.meta.url));
const isSource = (file) => /\.(js|jsx)$/.test(file) && !/\.test\.(js|jsx)$/.test(file);

/** A file's code without its comments: block comments, and line comments that start a line or follow a space. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

/** Every Hinglish string a value holds: the `hi` and `hinglish` of each object, deeply, with functions called. */
function hinglishOf(value, args = ["Riya", "Chess"]) {
  if (typeof value === "function") return value.length <= args.length ? hinglishOf(value(...args)) : [];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    (key === "hi" || key === "hinglish") && typeof inner === "string" ? [inner] : hinglishOf(inner),
  );
}

/** The Hinglish half of a share text: its first line (shareText.js puts Hinglish first, then English). */
const firstLine = (text) => text.split("\n")[0];
const dailyHinglish = (status) =>
  dailyPuzzleText({
    kind: "chess",
    number: 12,
    status,
    grid: ["firstTry", "afterMistakes"],
    hintsTaken: 0,
    streak: 5,
  }).split("\n")[2];

/**
 * Each copy module, every Hinglish line it makes, and whether it speaks to the player (then it must use tum). The
 * result lines (games/outcomeMoment.js and each game's outcome words) are made only from a finished room, so the
 * source scan reads them, templates included.
 */
const COPY_MODULES = Object.freeze([
  { name: "ageCopy", lines: hinglishOf(ageCopy), speaksToPlayer: true },
  { name: "feedbackText", lines: hinglishOf(feedbackText), speaksToPlayer: true },
  { name: "profileCopy", lines: hinglishOf(profileCopy), speaksToPlayer: true },
  { name: "reportText", lines: hinglishOf(reportText), speaksToPlayer: true },
  {
    name: "friendsCopy",
    lines: [...hinglishOf(friendsCopy), ...hinglishOf(friendsCopy.linkInviteCopy(FRIEND_LINK_MAKER_NAME))],
    speaksToPlayer: true,
  },
  { name: "challengeCopy", lines: hinglishOf(challengeCopy), speaksToPlayer: true },
  {
    name: "shareText",
    lines: [
      firstLine(inviteText({ gameId: "chess", code: "AB2CD3" })),
      firstLine(friendLinkText()),
      firstLine(challengeText({ gameId: "chess" })),
      dailyHinglish("solved"),
      dailyHinglish("failed"),
    ],
    speaksToPlayer: true,
  },
]);

describe('Hinglish uses "tum", never "aap" (owner, 2026-10-20; CC-217, CC-351)', () => {
  it("in no source file of the web app, outside comments", () => {
    const files = readdirSync(SRC, { recursive: true }).map(String).filter(isSource);
    const found = files.flatMap((file) =>
      withoutComments(readFileSync(join(SRC, file), "utf8"))
        .split("\n")
        .filter((line) => AAP.test(line))
        .map((line) => `${relative(SRC, join(SRC, file))}: ${line.trim()}`),
    );

    // The scan reads the whole app, the inline Hinglish of the privacy settings included.
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(join("pages", "ProfilePage", "PrivacySettings.jsx"));
    expect(found).toEqual([]);
  });

  it.each(COPY_MODULES)("in every line $name makes", ({ lines, speaksToPlayer }) => {
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => AAP.test(line))).toEqual([]);
    if (speaksToPlayer) expect(lines.some((line) => TUM.test(line))).toBe(true);
  });

  it("refuses the polite forms and lets tum through", () => {
    for (const polite of [
      "Aap jeet gaye",
      "aapka turn",
      "Dobara try kijiye",
      "Phir se khel karein",
      "Kya aap khelenge?",
      "Baith jaiyein?",
    ]) {
      expect(polite).toMatch(AAP);
    }
    for (const plain of [
      "Tum jeet gaye",
      "tumhara turn",
      "Dobara try karo",
      "Ek game ho jaaye?",
      "Kya chahiye?",
    ]) {
      expect(plain).not.toMatch(AAP);
    }
  });
});
