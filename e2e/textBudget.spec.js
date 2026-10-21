import { appendFileSync } from "node:fs";
import { expect, test } from "./fixtures.js";

// The text budget of the key screens (CC-313 section 3, owner 2026-10-20): the visible words in `main`, above the
// fold and in all, at a phone's 390 by 844 and a laptop's 1280 by 720. A screen over its budget fails the pull
// request that made it so, and every run writes the counts to the job summary, so each change shows in review.

/** Words above the fold, by screen. All of `main` may hold twice that. The same on a phone and a laptop. */
export const TEXT_BUDGETS = Object.freeze({
  home: 80,
  "game page": 120,
  "room waiting": 60,
  "room playing (outside the board)": 30,
  result: 60,
  "sign-up": 80,
});
/**
 * Screens measured over their budget when this test was added (2026-10-21), so the test fails only if they grow.
 * Each is a finding for the owner, who either trims the screen (a ticket) or changes its budget, with a reason, in
 * the pull request that does. Remove a line once its screen fits.
 */
export const OVER_BUDGET_TODAY = Object.freeze({
  // The result with its rewards and the save progress card: 69 to 74 words above the fold in Chromium, as the
  // rewards of the game vary, so a few words of room.
  result: Object.freeze({ fold: 80, words: 120 }),
});
const SIZES = Object.freeze([
  ["phone", { width: 390, height: 844 }],
  ["laptop", { width: 1280, height: 720 }],
]);

/**
 * The visible words of `main` in the page, all and above the fold, as the runtime measure counts them
 * (apps/web/src/lib/telemetry/textMeasure.js), leaving out what is inside `without`.
 */
function countInPage(page, without = "") {
  return page.evaluate((skip) => {
    const root = document.querySelector("main");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let words = 0;
    let fold = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const element = node.parentElement;
      const count = (node.textContent ?? "").match(/\S+/g)?.length ?? 0;
      const hidden =
        element.closest("[hidden], [aria-hidden='true']") !== null ||
        !element.checkVisibility({ visibilityProperty: true });
      if (count === 0 || hidden || (skip !== "" && element.closest(skip) !== null)) continue;
      words += count;
      range.selectNodeContents(node);
      if (range.getBoundingClientRect().top < window.innerHeight) fold += count;
    }
    return { words, fold };
  }, without);
}

const counted = [];

test.afterAll(() => {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary || counted.length === 0) return;
  const rows = counted.map(
    ({ screen, size, fold, words, budget }) =>
      `| ${screen} | ${size} | ${fold} / ${budget}${OVER_BUDGET_TODAY[screen] ? " (over, known)" : ""} | ${words} / ${budget * 2} |`,
  );
  appendFileSync(
    summary,
    [
      "",
      "### Text budget (CC-313)",
      "",
      "| Screen | Size | Above the fold | All of main |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
});

test("key screens stay within their text budget", async ({ players }, testInfo) => {
  // The sizes are set here, so one project runs it.
  // One engine, so the counts compare from run to run: fonts wrap words differently in Firefox and WebKit.
  test.skip(testInfo.project.name !== "desktop", "both sizes run in the Chromium desktop project");
  test.setTimeout(120_000);
  const alice = await players.open("alice");
  const bob = await players.open("bob");
  const measure = async (page, screen, without) => {
    for (const [size, viewport] of SIZES) {
      await page.setViewportSize(viewport);
      // A moment for the layout to settle at the new size.
      await page.waitForTimeout(100);
      const { words, fold } = await countInPage(page, without);
      counted.push({ screen, size, words, fold, budget: TEXT_BUDGETS[screen] });
    }
  };

  await alice.page.goto("/");
  await expect(alice.page.getByRole("button", { name: "Play as a guest" })).toBeVisible();
  await measure(alice.page, "home");

  await alice.page.goto("/games/tic-tac-toe");
  await expect(alice.page.getByRole("button", { name: "Create room" })).toBeVisible();
  await measure(alice.page, "game page");

  await alice.page.goto("/signup");
  await expect(alice.page.getByRole("button", { name: "Create account" })).toBeVisible();
  await measure(alice.page, "sign-up");

  await alice.page.goto("/games/tic-tac-toe");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await expect(alice.page.locator("[data-cc-phase]")).toHaveAttribute("data-cc-phase", "waiting");
  await measure(alice.page, "room waiting");

  await bob.page.goto(invite);
  await bob.page.locator('[data-cc-control="join.guest"]').click();
  await expect(alice.page.locator("[data-cc-phase]")).toHaveAttribute("data-cc-phase", /my-turn|their-turn/);
  await expect(bob.page.locator("[data-cc-phase]")).toHaveAttribute("data-cc-phase", /my-turn|their-turn/);
  await alice.page.setViewportSize(SIZES[1][1]);
  await measure(alice.page, "room playing (outside the board)", '[data-cc-slot="stage"]');

  // Tic-Tac-Toe to a finish: the first player takes the top row.
  const aliceFirst =
    (await alice.page.locator("[data-cc-phase]").getAttribute("data-cc-phase")) === "my-turn";
  const [first, second] = aliceFirst ? [alice, bob] : [bob, alice];
  const cell = (player, index) => player.page.locator('[data-cc-control="ttt.cell"]').nth(index);
  for (const [index, at] of [0, 3, 1, 4, 2].entries()) {
    const [mover, next] = index % 2 === 0 ? [first, second] : [second, first];
    await cell(mover, at).click();
    if (index < 4)
      await expect(next.page.locator("[data-cc-phase]")).toHaveAttribute("data-cc-phase", "my-turn");
  }
  await expect(alice.page.locator("[data-cc-phase]")).toHaveAttribute("data-cc-phase", "finished");
  await measure(alice.page, "result");

  // eslint-disable-next-line no-console
  console.info(
    counted
      .map(({ screen, size, fold, words }) => `${screen} ${size}: ${fold} above, ${words} in all`)
      .join("\n"),
  );
  const over = counted.filter(({ screen, fold, words, budget }) => {
    const allowed = OVER_BUDGET_TODAY[screen] ?? { fold: budget, words: budget * 2 };
    return fold > allowed.fold || words > allowed.words;
  });
  expect(over).toEqual([]);
});
