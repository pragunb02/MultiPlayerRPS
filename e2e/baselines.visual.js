import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";
import { phaseIs } from "./matchStates.js";
import { newAccount } from "./personas.js";

// Screenshot baselines of the main screens, light and dark, on a laptop and a phone (CC-155). Each state is reached
// for real, as a player gets there. Anything that changes from run to run is made the same before the comparison,
// so a diff means the look changed. Run only in the pinned container: `npm run test:visual`, and
// `npm run test:visual:update` after a change on purpose (scripts/visual/docker.mjs).

const SCHEMES = Object.freeze(["light", "dark"]);
const MASK_COLOR = "#ff00ff";

/**
 * Names made for this run, and what each is drawn as instead. The stand-in has the same number of characters, so
 * the text takes the same room every run. Each name is still drawn in its real font, size and colour.
 */
const STAND_INS = Object.freeze([
  { pattern: "Guest-[A-Za-z0-9]{4}", text: "Guest-ABCD" },
  { pattern: "riya\\.\\d{10}@example\\.com", text: "riya.0000000000@example.com" },
  { pattern: "riya_\\d{10}", text: "riya_0000000000" },
]);

/**
 * The parts of a page that differ between runs and are painted over in Playwright's mask colour. Playwright's own
 * `mask` option adds a <style> element, which the page's security policy blocks. Styles set from script are allowed
 * (ADR-016 point 4), so each part is painted from script, in place, keeping its size.
 *
 * @param {import("@playwright/test").Page} page
 */
const painted = (page) => [
  page.getByRole("textbox", { name: "Invite link" }),
  // Every clock that counts down: the chess clocks, the time left to move, the rematch offer.
  page.locator("[data-cc-ticker]"),
  page.locator("main time"),
];

/**
 * Makes the page the same in every run: stand-ins for names, a painted box over the parts that differ, the daily
 * quests painted at one height (which quests a player gets, and so how many lines they take, is chosen by player
 * and date), and no toasts (they leave on a timer, so whether one is still there depends on the machine's speed).
 * visual.spec.js and screens.spec.js check what these parts say.
 *
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator[]} extra more parts to paint
 */
async function steady(page, extra) {
  for (const locator of [...painted(page), ...extra]) {
    for (const element of await locator.all()) {
      await element.evaluate(paint, { color: MASK_COLOR });
    }
  }
  for (const quests of await page.getByRole("region", { name: "Daily quests" }).all()) {
    await quests.evaluate(paint, { color: MASK_COLOR, height: "240px" });
  }
  await page.evaluate(standInNames, STAND_INS);
  // The room code is drawn as six letters a reviewer can read, so it gets a fixed code rather than a box.
  for (const code of await page.locator('strong[aria-label^="Room code"]').all()) {
    await code.evaluate((node) => (node.firstChild.nodeValue = "ABC234"));
  }
  // The toast region, which the app's CSS module names `_region_<hash>`. Hidden, so later toasts are too.
  await page
    .locator('[role="status"][aria-live="polite"][class*="_region_"]')
    .evaluateAll((regions) => regions.forEach((region) => (region.style.visibility = "hidden")));
}

/**
 * Runs in the page: swaps each name for its stand-in, now and whenever the app redraws a text later (a new
 * message in the room, a seat that changes). React often splits one line into several text nodes ("Guest-" and
 * "KAW5"), so each run of neighbouring text nodes is matched as one string. Every stand-in has the length of what
 * it replaces, so each node keeps its length and React can still update it.
 */
function standInNames(standIns) {
  const swap = () => {
    const runs = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const previous = node.previousSibling;
      const run = previous?.nodeType === Node.TEXT_NODE ? runs.get(previous) : [];
      run.push(node);
      runs.set(node, run);
    }
    for (const run of new Set(runs.values())) {
      let text = run.map((node) => node.nodeValue).join("");
      for (const { pattern, text: standIn } of standIns)
        text = text.replace(new RegExp(pattern, "g"), standIn);
      let at = 0;
      for (const node of run) {
        const next = text.slice(at, at + node.nodeValue.length);
        at += node.nodeValue.length;
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    }
  };
  swap();
  if (window.ccVisualStandIns) return;
  // A second pass after its own changes finds nothing more to swap, so this settles at once.
  window.ccVisualStandIns = new MutationObserver(swap);
  window.ccVisualStandIns.observe(document.body, { subtree: true, childList: true, characterData: true });
}

/** Runs in the page: paints one element in the mask colour, hides what is inside it, and can fix its height. */
function paint(node, { color, height }) {
  node.style.setProperty("background", color, "important");
  node.style.setProperty("color", "transparent", "important");
  node.style.setProperty("border-color", color, "important");
  if (height) {
    node.style.setProperty("height", height, "important");
    node.style.setProperty("overflow", "hidden", "important");
  }
  for (const inside of node.querySelectorAll("*"))
    inside.style.setProperty("visibility", "hidden", "important");
}

/**
 * Compares the page with its baselines in both themes. The mouse is moved away and focus is taken off any field
 * first, because a hover and a blinking caret show in a screenshot. Boards and cards that load later ("Loading
 * the board…", "Loading progress…") must be there first.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} name the screen and its state, which names the baseline file
 * @param {{ mask?: import("@playwright/test").Locator[] }} [options] more parts to paint over
 */
async function matchesBaselines(page, name, { mask = [] } = {}) {
  await expect(page.getByText(/^Loading\b/)).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await steady(page, mask);
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme });
    await expect(page).toHaveScreenshot(`${name}-${colorScheme}.png`, { fullPage: true });
  }
}

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
const phase = (player) => player.page.locator("[data-cc-phase]");

/** The most rooms opened to get a match the host starts. Each try is a coin toss, so ten all failing is 1 in 1024. */
const HOST_FIRST_TRIES = 10;

/**
 * A new host creates a room for `slug`, a new guest joins it, and both see the match start. Who moves first (and
 * so who plays X or White) is drawn at random by the server, and it changes the screen: the seat cards, the board's
 * side. So this opens new rooms until the host moves first, and the same player is looked at in every run.
 * Answers the host and the guest.
 *
 * @param {{ open: (name: string) => Promise<any> }} players the players fixture
 * @param {string} slug the game's address, as in /games/<slug>
 * @param {(page: import("@playwright/test").Page) => Promise<unknown>} [lobby] sets the lobby's options
 */
async function startMatchWithHostFirst(players, slug, lobby) {
  for (let attempt = 1; attempt <= HOST_FIRST_TRIES; attempt++) {
    const host = await players.open(`host ${attempt}`);
    const guest = await players.open(`guest ${attempt}`);
    await host.page.goto(`/games/${slug}`);
    await lobby?.(host.page);
    await host.page.getByRole("button", { name: "Create room" }).click();
    const invite = await host.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    await joinAsGuest(guest, invite);
    for (const player of [host, guest]) {
      await expect(phase(player)).toHaveAttribute("data-cc-phase", /my-turn|their-turn/);
    }
    if (slug === "rock-paper-scissors" || (await phase(host).getAttribute("data-cc-phase")) === "my-turn") {
      return { host, guest };
    }
  }
  throw new Error(`the guest moved first in ${HOST_FIRST_TRIES} rooms in a row`);
}

test("a visitor's screens: home, login, sign-up, the visitor profile, the leaderboard and the 404", async ({
  players,
}) => {
  const visitor = await players.open("visitor");
  const { page } = visitor;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Play the classics with anyone, in one click." }),
  ).toBeVisible();
  await matchesBaselines(page, "home-visitor");

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await matchesBaselines(page, "login");

  await page.goto("/signup");
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await matchesBaselines(page, "signup");

  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await matchesBaselines(page, "profile-visitor");

  await page.goto("/leaderboards/overall");
  await expect(page.getByRole("navigation", { name: "Leaderboards" })).toBeVisible();
  // Only accounts are ranked, and no account wins in this file, so the board on the visual job's own server is
  // the same every run.
  await matchesBaselines(page, "leaderboard");

  visitor.expect(404, "/no/such/page");
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await matchesBaselines(page, "not-found");
});

test("a new account's profile", async ({ players }) => {
  const account = newAccount();
  const player = await players.open("riya", { secrets: [account.password, account.email] });
  const { page } = player;
  await page.goto("/signup");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/\/signup/);

  await page.goto("/profile");
  await expect(page.getByText("No games yet.")).toBeVisible();
  await matchesBaselines(page, "profile");
});

test("a guest's home and lobby, and a room waiting for a friend", async ({ players }) => {
  const host = await players.open("host");
  const { page } = host;
  await page.goto("/");
  await page.getByRole("button", { name: "Play as a guest" }).click();
  await expect(page.getByText(/You're playing as Guest-/)).toBeVisible();
  await matchesBaselines(page, "home-guest");

  await page.goto("/games/chess");
  await expect(page.getByRole("combobox", { name: /time control/i })).toBeVisible();
  await matchesBaselines(page, "lobby-chess");

  await createRoom(host, "tic-tac-toe");
  await phaseIs(host, "waiting");
  await matchesBaselines(page, "room-waiting");
});

test("Rock Paper Scissors while choosing, and the result after a win", async ({ players }) => {
  // Both players choose at the same time, so who is first does not change this screen.
  const { host, guest } = await startMatchWithHostFirst(players, "rock-paper-scissors", (page) =>
    page.getByRole("combobox", { name: /match length/i }).selectOption("1"),
  );
  await expect(choices(host)).toBeVisible();
  await matchesBaselines(host.page, "playing-rps");

  await choices(host).getByRole("button", { name: /Rock/ }).click();
  await choices(guest)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(host.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await phaseIs(host, "finished");
  // The win's XP and the day's quests reach the browser after the result. A quest finished by this win adds a
  // bonus, and which quests a guest gets is chosen at random, so the level and XP shown are painted over once
  // both have arrived (visual.spec.js checks the numbers).
  const arrived = (event) => host.record.socketFrames.some((frame) => frame.includes(`"${event}"`));
  await expect.poll(() => arrived("progress:updated") && arrived("quests:updated")).toBe(true);
  const progress = [
    host.page.getByRole("banner").getByRole("progressbar"),
    host.page
      .getByRole("list", { name: "What you'd keep" })
      .getByRole("listitem")
      .filter({ hasText: /Level \d+|\d+ XP/ }),
  ];
  await matchesBaselines(host.page, "result-win", { mask: progress });
});

test("Tic-Tac-Toe after the host's first move, on the guest's turn", async ({ players }) => {
  const { host, guest } = await startMatchWithHostFirst(players, "tic-tac-toe");
  await host.page.locator('main [data-cc-control="ttt.cell"]').nth(4).click();
  await phaseIs(guest, "my-turn");
  await matchesBaselines(guest.page, "playing-tictactoe");
});

test("Chess after 1. e4, on Black's turn", async ({ players }) => {
  const { host, guest } = await startMatchWithHostFirst(players, "chess");
  await expect(guest.page.getByRole("grid", { name: "Chess board" })).toBeVisible();
  const square = (name) => host.page.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) });
  await square("e2").click();
  await square("e4").click();
  await phaseIs(guest, "my-turn");
  await matchesBaselines(guest.page, "playing-chess");
});
