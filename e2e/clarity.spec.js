import { expect, test } from "./fixtures.js";
import { computerStatesFor, GAMES, openPair, statesFor } from "./matchStates.js";
import { OWNER } from "./ownerConsole.js";
import { newAccount } from "./personas.js";

// Clarity checks a machine can see (CC-351; checks A1, A3 and A6 of docs/design/CLARITY-AUDIT.md, CONTRACT
// section 7). Each settled screen the walk reaches, on the desktop and on the phone, is read for three things:
//
// - A1, one h1. Exactly one level 1 heading, which names the screen (C10). A loading screen has one too, so nothing
//   is excused: the count waits for the screen to settle and then must stay at one.
// - A3, named controls. Every visible control (button, link, [role=button] and the like) has an accessible name,
//   and the name is never a bare "Close", "X", "OK" or "Submit". A control that shows no letter or digit must be on
//   CONTROLS_WITHOUT_WORDS below, which may only shrink.
// - A6, button words, advisory. A button's words start with a verb, or are on BUTTON_WORDS. A button that does not
//   is written down as a warning on the test and in its output, and never fails it (C2).
//
// A2 (How to play on every game, CC-349) and A4 (no raw server words in an error, CC-350) are checked elsewhere.

/**
 * Controls that may show no letter or digit, or a bare name, with why and the finding that fixes them. This list
 * may only shrink: a clarity batch that gives a control words removes its line and lowers RECORDED_SIZE with it.
 * Never add a line or raise RECORDED_SIZE; give the control a visible word instead (C6). The test below fails when
 * the list grows past RECORDED_SIZE.
 *
 * Each key is the control's `data-cc-control`, or `role "name"` when it has none. `bareName` allows that one
 * control's bare name (A3), until its finding is fixed.
 */
const CONTROLS_WITHOUT_WORDS = Object.freeze({
  // The logo, named "ClassiCade home". Every site's logo goes home; it is not a finding.
  "header.home": { because: "the logo, named ClassiCade home" },
  // The header, CL-03 and CL-04 (batch B6).
  "header.sound": { because: "the speaker, named Sound on or Sound off", finding: "CL-03" },
  "header.sound_settings": { because: "the gear, named Sound settings", finding: "CL-03" },
  "header.menu": { because: "the phone's three bars, named Menu", finding: "CL-04" },
  // The chess move list's steps «, ‹, › and », CL-41 (batch B4).
  "chess.moves.first": { because: "«, named First position", finding: "CL-41" },
  "chess.moves.previous": { because: "‹, named Previous move", finding: "CL-41" },
  "chess.moves.next": { because: "›, named Next move", finding: "CL-41" },
  "chess.moves.latest": { because: "», named Latest move", finding: "CL-41" },
  // The promotion picker's pieces, CL-42 (batch B4).
  "chess.promote": { because: "a piece's picture, named by the piece", finding: "CL-42" },
  // The boards: each square and cell is named ("e2, white pawn", "top left: empty"). That is right for a board.
  "chess.square": { because: "a board square, named by its square and piece" },
  "ttt.cell": { because: "a board cell, named by its place and mark" },
  // The dismiss ×, DismissButton.jsx. Each names what it closes, except the two bare "Close" below.
  "save.dismiss": { because: "×, named Close: save your progress" },
  "streak.dismiss": { because: "×, named Close: streak reminder" },
  // The request banner's answer (RequestBanner.jsx), named only "Close", CL-36 (batch B4). The audit's walk met it
  // twice.
  "request.dismiss": { because: "×, named only Close", finding: "CL-36", bareName: "Close" },
  // Toasts: "Close: save your level" (ProgressToasts.jsx), and only "Close" for a friend request
  // (FriendRequestToasts.jsx) and a request from another room (SiteRequests.jsx). Found by CC-351 reading the code,
  // next to CL-36; the fix is the same, a name that says what closes.
  "toast.dismiss": {
    because: "×, named Close: save your level, or only Close",
    finding: "CL-36",
    bareName: "Close",
  },
});
/** How many lines CONTROLS_WITHOUT_WORDS had when it was last cut. Only ever lower it, never raise it. */
const RECORDED_SIZE = 16;

/** Names that say nothing about what the control does (C2, A3). Compared without case and spaces. */
const BARE_NAMES = new Set(["close", "x", "×", "✕", "ok", "submit"]);

/**
 * Buttons whose words are a name, not an action, so they need no verb (A6): the thing the press picks. Keyed by
 * `data-cc-control`, and kept short on purpose.
 */
const BUTTON_WORDS = Object.freeze(
  new Set([
    "rps.choice", // a hand: Rock, Paper, Scissors
    "lobby.computer_level", // a level of the computer: Beginner, Easy, Unbeatable
    "chess.moves.go", // a move in the move list, in chess notation: e4, Nf6
  ]),
);

/** Verbs a button may start with (C2: a verb and its object). A button outside them is reported, not failed. */
const VERBS = Object.freeze(
  new Set(
    `accept add allow answer appear ask back block cancel change check choose clear close confirm continue copy
    correct create decline delete dismiss download draw export find finish flip follow get give go hide invite join
    keep leave let load log look make mark mute next offer open pass pick play post preview previous read reload
    remove rematch report request reset resign restart retry review save see select send set share show sign skip
    start stay step stop submit switch take tell try turn undo unblock unmute update use view wait watch`.split(
      /\s+/,
    ),
  ),
);

/**
 * What a screen shows: every visible control with its accessible name, its words and its kind, and the visible
 * buttons' words. The name is read as browsers name a control, in short: aria-labelledby, aria-label, then the
 * words inside (with each image's alt), then the title.
 */
async function readControls(page) {
  return page.evaluate(() => {
    const SELECTOR = [
      "button",
      "a[href]",
      "summary",
      "input[type=button]",
      "input[type=submit]",
      "input[type=reset]",
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="switch"]',
      "[data-cc-control]",
    ].join(", ");
    const isShown = (element) =>
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden" &&
      element.closest('[aria-hidden="true"], [inert], [hidden]') === null;
    const isControl = (element) =>
      !(element instanceof HTMLInputElement && !["button", "submit", "reset"].includes(element.type)) &&
      !(element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement);
    const textOf = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.getAttribute("aria-hidden") === "true") return "";
      if (node.hasAttribute("aria-label")) return node.getAttribute("aria-label");
      if (node.tagName === "IMG") return node.getAttribute("alt") ?? "";
      return [...node.childNodes].map(textOf).join("");
    };
    const nameOf = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
      }
      if (element.getAttribute("aria-label")) return element.getAttribute("aria-label");
      if (element instanceof HTMLInputElement) return element.value;
      const inside = [...element.childNodes].map(textOf).join("");
      return inside.trim() === "" ? (element.getAttribute("title") ?? "") : inside;
    };
    const tidy = (text) => text.replace(/\s+/g, " ").trim();
    const roleOf = (element) =>
      element.getAttribute("role") ?? (element.tagName === "A" ? "link" : element.tagName.toLowerCase());
    return (
      [...document.querySelectorAll(SELECTOR)]
        .filter((element) => isShown(element) && isControl(element))
        // A control inside another control is one control: its parent is read.
        .filter(
          (element) => element.parentElement?.closest(SELECTOR) === null || !isShown(element.parentElement),
        )
        .map((element) => {
          const name = tidy(nameOf(element));
          const words = tidy(element instanceof HTMLInputElement ? element.value : element.innerText);
          const id = element.getAttribute("data-cc-control");
          const role = roleOf(element);
          return {
            kind: id ?? `${role} "${name}"`,
            role,
            name,
            words,
            isButton: role === "button" || element instanceof HTMLButtonElement,
          };
        })
    );
  });
}

/** Whether `text` has a letter or a digit a sighted player can read. */
const hasWords = (text) => /[\p{L}\p{N}]/u.test(text);

/**
 * Reads one settled screen and adds what breaks A1 and A3 to `problems`, and A6's advisories to `advice`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} screen  what the screen is, for the messages
 * @param {{ problems: string[], advice: Set<string> }} found
 */
async function checkScreen(page, screen, { problems, advice }) {
  const h1 = page.getByRole("heading", { level: 1 });
  // Wait for the screen to settle on one h1, then make sure it stays one.
  await expect(h1, `${screen}: exactly one h1`)
    .toHaveCount(1, { timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(300);
  const headings = await h1.allInnerTexts();
  if (headings.length !== 1) {
    problems.push(
      `A1 ${screen}: ${headings.length} h1 (${headings.map((text) => JSON.stringify(text)).join(", ")})`,
    );
  }

  for (const control of await readControls(page)) {
    const allowed = Object.hasOwn(CONTROLS_WITHOUT_WORDS, control.kind)
      ? CONTROLS_WITHOUT_WORDS[control.kind]
      : undefined;
    if (control.name === "") {
      problems.push(`A3 ${screen}: ${control.kind} has no accessible name`);
    } else if (BARE_NAMES.has(control.name.toLowerCase()) && allowed?.bareName !== control.name) {
      problems.push(`A3 ${screen}: ${control.kind} is named only "${control.name}"`);
    }
    if (!hasWords(control.words) && allowed === undefined) {
      problems.push(
        `A3 ${screen}: ${control.kind} ("${control.name}") shows no word and is not on CONTROLS_WITHOUT_WORDS`,
      );
    }
    if (control.isButton && hasWords(control.words)) {
      const first = control.words
        .split(" ")[0]
        .toLowerCase()
        .replace(/[^\p{L}]/gu, "");
      if (!VERBS.has(first) && !BUTTON_WORDS.has(control.kind))
        advice.add(`"${control.words}" (${control.kind})`);
    }
  }
}

/** A fresh record for one test, and its end: A1 and A3 must be clean, A6's advisories are written down. */
function finding() {
  return { problems: [], advice: new Set() };
}
function report({ problems, advice }, testInfo) {
  if (advice.size > 0) {
    const words = [...advice].sort().join("; ");
    testInfo.annotations.push({
      type: "warning",
      description: `A6, buttons that start with no verb: ${words}`,
    });
    // A warning in the run's output, as computer.spec.js prints its timings. It never fails the test.
    process.stdout.write(`warning: A6, ${testInfo.project.name}, ${testInfo.title}: ${words}\n`);
  }
  expect(problems).toEqual([]);
}

test.describe("clarity (CC-351)", () => {
  test("CONTROLS_WITHOUT_WORDS only shrinks", () => {
    const size = Object.keys(CONTROLS_WITHOUT_WORDS).length;
    expect(size, "the list grew: give the new control a visible word instead (C6)").toBeLessThanOrEqual(
      RECORDED_SIZE,
    );
    for (const [kind, entry] of Object.entries(CONTROLS_WITHOUT_WORDS)) {
      expect(entry.because, `${kind} says why it shows no word`).toMatch(/\w/);
    }
  });

  test("the checks catch what they look for", async ({ page }) => {
    await page.setContent(`
      <h1>One</h1><h1>Two</h1>
      <button aria-label="Close"><span aria-hidden="true">×</span></button>
      <button data-cc-control="request.dismiss" aria-label="Close"><span aria-hidden="true">×</span></button>
      <button data-cc-control="new.icon" aria-label="Sparkles"><svg width="10" height="10"></svg></button>
      <a href="/x"><img alt="" src="data:,"></a>
      <button>Nice words</button>
      <button>Copy link</button>`);
    const found = finding();

    await checkScreen(page, "test page", found);

    expect(found.problems).toEqual([
      'A1 test page: 2 h1 ("One", "Two")',
      'A3 test page: button "Close" is named only "Close"',
      'A3 test page: button "Close" ("Close") shows no word and is not on CONTROLS_WITHOUT_WORDS',
      'A3 test page: new.icon ("Sparkles") shows no word and is not on CONTROLS_WITHOUT_WORDS',
      'A3 test page: link "" has no accessible name',
      'A3 test page: link "" ("") shows no word and is not on CONTROLS_WITHOUT_WORDS',
    ]);
    expect([...found.advice]).toEqual(['"Nice words" (button "Nice words")']);
  });

  test("every page a visitor can open", async ({ players }, testInfo) => {
    test.setTimeout(180_000);
    const visitor = await players.open("visitor");
    for (const path of [
      "/no-such-page",
      "/games/chess/rooms/ZZZZZZ",
      "/admin",
      "/players/no-such-player",
      "/api/profiles/no-such-player",
      "/challenge/no-such-challenge",
      "/api/challenges/no-such-challenge",
      "/friends/add/no-such-token",
      "/api/friends/links/no-such-token",
    ]) {
      visitor.expect(404, path);
    }
    const found = finding();
    const pages = [
      "/",
      "/games/rock-paper-scissors",
      "/games/tic-tac-toe",
      "/games/chess",
      "/games/rock-paper-scissors/pass-and-play",
      "/games/tic-tac-toe/pass-and-play",
      "/games/chess/pass-and-play",
      "/daily/chess",
      "/login",
      "/signup",
      "/profile",
      "/friends",
      "/leaderboards/overall",
      "/leaderboards/weekly",
      "/leaderboards/chess",
      "/privacy",
      "/terms",
      // The dead ends: a page, a room, a player, a challenge and a friend link that do not exist.
      "/no-such-page",
      "/games/chess/rooms/ZZZZZZ",
      "/players/no-such-player",
      "/challenge/no-such-challenge",
      "/friends/add/no-such-token",
      // Not found for anyone but the owner.
      "/admin",
    ];
    for (const path of pages) {
      await visitor.page.goto(path);
      await checkScreen(visitor.page, `visitor ${path}`, found);
    }
    report(found, testInfo);
  });

  test("a guest's and an account's own pages", async ({ players }, testInfo) => {
    test.setTimeout(120_000);
    const found = finding();
    const guest = await players.open("guest");
    await guest.page.goto("/");
    await guest.page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(guest.page.getByText(/You're playing as Guest-/)).toBeVisible();
    for (const path of ["/", "/profile", "/friends", "/games/chess", "/daily/chess"]) {
      if (guest.url() !== path) await guest.page.goto(path);
      await checkScreen(guest.page, `guest ${path}`, found);
    }

    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    await riya.page.goto("/signup");
    await riya.page.getByLabel("Username").fill(account.username);
    await riya.page.getByLabel("Email").fill(account.email);
    await riya.page.getByLabel("Password").fill(account.password);
    await riya.page.getByRole("button", { name: "Create account" }).click();
    await expect(riya.page).toHaveURL("/");
    for (const path of ["/", "/profile", "/friends"]) {
      if (riya.url() !== path) await riya.page.goto(path);
      await checkScreen(riya.page, `account ${path}`, found);
    }
    report(found, testInfo);
  });

  test("the owner console", async ({ players }, testInfo) => {
    test.setTimeout(120_000);
    const found = finding();
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    await owner.page.goto("/login");
    await owner.page.getByLabel("Email").fill(OWNER.email);
    await owner.page.getByLabel("Password").fill(OWNER.password);
    await owner.page.getByRole("button", { name: "Log in" }).click();
    await expect(owner.page).toHaveURL("/");
    const sections = ["statuses", "players", "games", "retention", "conversion", "engagement"];
    for (const path of [
      "/admin",
      ...sections.map((section) => `/admin/${section}`),
      "/admin/feedback",
      "/admin/reports",
      "/admin/ages",
      "/admin/flags",
      "/admin/design",
    ]) {
      await owner.page.goto(path);
      await checkScreen(owner.page, `owner ${path}`, found);
    }
    report(found, testInfo);
  });

  for (const gameId of Object.keys(GAMES)) {
    const states = { ...statesFor(gameId), ...computerStatesFor(gameId) };
    for (const [state, build] of Object.entries(states)) {
      test(`${gameId} ${state}, both players' screens`, async ({ players }, testInfo) => {
        test.setTimeout(90_000);
        const found = finding();
        const pair = await openPair(players);
        const { clicker, other } = await build(pair);
        await checkScreen(clicker.page, `${gameId} ${state}, ${clicker.name}`, found);
        if (other !== undefined && other !== clicker) {
          await checkScreen(other.page, `${gameId} ${state}, ${other.name}`, found);
        }
        report(found, testInfo);
      });
    }
  }
});
