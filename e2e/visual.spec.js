import { expect, formFactor, joinAsGuest, test } from "./fixtures.js";

// The arcade look (CC-087, ADR-012): every themed screen renders in light and dark with no CSP violations or
// console errors (the players fixture checks), celebrations play, and with reduced motion nothing moves while
// every message is still there as text.

const SCHEMES = ["light", "dark"];

/** Alice and Bob play one round of Rock Paper Scissors in a new room; Alice wins. Returns the room path. */
async function aliceBeatsBob(alice, bob) {
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  // Bob's first invite asks how to join (CC-086); after that he has a guest session.
  if ((await bob.context.cookies()).length === 0) {
    await joinAsGuest(bob, invite);
  } else {
    await bob.page.goto(invite);
  }
  const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
  await choices(alice).getByRole("button", { name: /Rock/ }).click();
  await choices(bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  return new URL(invite).pathname;
}

/**
 * The header chip shows the player's stored progress. A win is 30 XP, and the day's quests (CC-089, chosen by player
 * and date) may add a bonus, so the expected numbers are read from the API once the server has caught up.
 */
async function expectChipToFollowProgress(page) {
  await expect(async () => {
    const { progress } = await (await page.request.get("/api/progress")).json();
    expect(progress.xp).toBeGreaterThanOrEqual(30);
    const name = `Level ${progress.level}: ${progress.xpIntoLevel} of ${progress.xpForNextLevel} XP`;
    await expect(page.getByRole("banner").getByRole("progressbar", { name })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/**
 * After Alice's first win, waits for her level-up, or wins once more for it. Level 2 starts at 50 XP and a win is
 * 30, so the second win always gets there. A quest bonus on the first win can get there sooner. Whether it did is
 * only known once the server has finished the first win's work: its match XP and its quests reached the browser.
 * The quest bonus XP is sent before the quests, so by then any level-up from the first win has arrived too.
 */
async function untilLevelTwo(alice, bob) {
  const frames = (text) => alice.record.socketFrames.filter((frame) => frame.includes(text));
  const firstWinDone = () => frames('"progress:updated"').length > 0 && frames('"quests:updated"').length > 0;
  await expect.poll(firstWinDone, { timeout: 15_000 }).toBe(true);
  if (frames('"leveledUp":true').length === 0) {
    await aliceBeatsBob(alice, bob);
  }
  return toast(alice.page, "Level up! You reached level 2");
}

const animationCount = (page) => page.evaluate(() => document.getAnimations().length);
const effect = (page, name) => page.locator(`[data-effect="${name}"]`);
/** A toast. (The room's result panel is a status region too, and its art repeats the XP.) */
const toast = (page, text) =>
  page
    .getByRole("status")
    .filter({ hasText: text })
    .filter({ hasNotText: /You won|You lost|Draw (by|with|on)/ });

for (const colorScheme of SCHEMES) {
  test(`home, lobby, profile, leaderboards, invite and 404 render in the ${colorScheme} theme`, async ({
    players,
  }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    await page.emulateMedia({ colorScheme });

    // An invite link, before choosing how to join (CC-086): the envelope art over the choice.
    await page.goto("/games/tic-tac-toe/rooms/AB2CD3");
    const chooser = page.getByRole("region", { name: "You're invited to play Tic Tac Toe" });
    await expect(chooser.locator("svg").first()).toBeVisible();
    await expect(chooser.getByRole("button", { name: "Play as guest" })).toBeVisible();

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Play the classics with anyone, in one click." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "ClassiCade home" }).locator("svg")).toBeVisible();
    await expect(page.locator("main li svg")).toHaveCount(3); // every game card is illustrated
    await page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(
      page.getByRole("banner").getByRole("progressbar", { name: /^Level 1: 0 of 50 XP/ }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Chess", exact: true }).click();
    await expect(page).toHaveURL("/games/chess");
    await expect(page.getByRole("heading", { name: "Chess", exact: true })).toBeVisible();

    // The quest card on home (CC-089), now that there is a player.
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Daily quests" })).toBeVisible();

    await page.goto("/profile");
    await expect(page.getByText("Rookie rank")).toBeVisible();
    await expect(page.getByText("No games yet.")).toBeVisible();
    // The player console: every achievement drawn as a medal, the streak as a flame.
    const achievements = page.getByRole("list", { name: "Achievements" }).getByRole("listitem");
    await expect(achievements.first()).toBeVisible();
    await expect(achievements.locator("svg")).toHaveCount(await achievements.count());
    await expect(page.getByRole("region", { name: "Streaks" }).locator("svg")).toBeVisible();

    await page.goto("/leaderboards/overall");
    const tabs = page.getByRole("navigation", { name: "Leaderboards" }).getByRole("link");
    await expect(tabs.locator("svg")).toHaveCount(await tabs.count());

    visitor.expect(404, "/no/such/page"); // a real 404 from the server (CC-047)
    await page.goto("/no/such/page");
    await expect(page.getByRole("img", { name: /game over, page not found/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test(`a win is celebrated in the ${colorScheme} theme, and the header follows the XP`, async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    await alice.page.emulateMedia({ colorScheme });

    const room = await aliceBeatsBob(alice, bob);

    await expect(alice.page.getByText("Victory!")).toBeVisible();
    // The win's confetti (and, for a first win, the achievement's too).
    await expect(effect(alice.page, "confetti").first()).toBeAttached();
    await expect(toast(alice.page, "+30 XP")).toBeAttached();
    // A first win unlocks achievements: their toasts carry the medal.
    await expect(
      toast(alice.page, "Achievement unlocked: First Victory").locator("svg").first(),
    ).toBeAttached();
    await expect(bob.page.getByText("Defeat")).toBeVisible();
    await expect(effect(bob.page, "confetti")).toHaveCount(0);
    await expectChipToFollowProgress(alice.page);

    // The result survives a reload and a trip through history, as the same screen.
    await alice.page.reload();
    await expect(alice.page).toHaveURL(room);
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expectChipToFollowProgress(alice.page);
    await alice.page.getByRole("button", { name: "New opponent" }).click();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
    // New opponent gives the seat up, so Back does not show the old result again (CC-162).
    await alice.page.goBack();
    await expect(alice.page).not.toHaveURL(room);
  });
}

test("a level-up bursts behind the new badge", async ({ players }) => {
  const alice = await players.open("alice");
  const bob = await players.open("bob");
  await aliceBeatsBob(alice, bob);
  const levelUp = await untilLevelTwo(alice, bob);

  await expect(levelUp).toBeAttached();
  await expect(effect(alice.page, "level-up")).toBeAttached();
  await expect(effect(alice.page, "level-up")).toHaveCount(0, { timeout: 5_000 }); // and clears itself
  await expect(alice.page.getByRole("banner").getByRole("progressbar", { name: /^Level 2:/ })).toBeVisible();
});

test("with reduced motion nothing animates after a win or a level-up, and the words are all there", async ({
  players,
}) => {
  const alice = await players.open("alice");
  const bob = await players.open("bob");
  await alice.page.emulateMedia({ reducedMotion: "reduce" });

  await aliceBeatsBob(alice, bob);
  await expect(toast(alice.page, "+30 XP")).toBeAttached();
  await expect(alice.page.getByText("Victory!")).toBeVisible();
  expect(await animationCount(alice.page)).toBe(0);
  await expect(effect(alice.page, "confetti")).toHaveCount(0);
  await expect(effect(alice.page, "xp-pop")).toHaveCount(0);

  await expect(await untilLevelTwo(alice, bob)).toBeAttached();
  expect(await animationCount(alice.page)).toBe(0);
  await expect(effect(alice.page, "level-up")).toHaveCount(0);
  await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
});

test("the game cards can be reached and opened with the keyboard, with a visible focus ring", async ({
  players,
}, testInfo) => {
  test.skip(formFactor(testInfo) === "mobile", "keyboard navigation is a desktop journey");
  // Safari's Tab key moves only between form fields unless the player turns on "Press Tab to highlight each item".
  // Option and Tab reaches links too, and that is the key a Safari keyboard user presses (CC-184).
  const nextItem = testInfo.project.use.defaultBrowserType === "webkit" ? "Alt+Tab" : "Tab";
  const { page } = await players.open("visitor");
  await page.goto("/");
  await expect(page.locator("main li")).toHaveCount(3);
  const focusedName = () => page.evaluate(() => document.activeElement?.textContent ?? "");

  const names = [];
  for (let press = 0; press < 20 && names.length < 3; press++) {
    await page.keyboard.press(nextItem);
    const name = await focusedName();
    if (["Rock Paper Scissors", "Tic Tac Toe", "Chess"].includes(name)) names.push(name);
  }

  expect(names).toEqual(["Rock Paper Scissors", "Tic Tac Toe", "Chess"]);
  const ring = await page.evaluate(() => {
    const ring = getComputedStyle(document.activeElement, "::after");
    return { style: ring.outlineStyle, width: ring.outlineWidth };
  });
  expect(ring).toEqual({ style: "solid", width: "3px" });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/games/chess");
});
