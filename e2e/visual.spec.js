import { expect, test } from "./fixtures.js";

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
  await bob.page.goto(invite);
  const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
  await choices(alice).getByRole("button", { name: /Rock/ }).click();
  await choices(bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(alice.page.getByRole("heading", { name: "You won!" })).toBeVisible();
  return new URL(invite).pathname;
}

const animationCount = (page) => page.evaluate(() => document.getAnimations().length);
const effect = (page, name) => page.locator(`[data-effect="${name}"]`);
/** A toast. (The room's result panel is a status region too, and its art repeats the XP.) */
const toast = (page, text) =>
  page.getByRole("status").filter({ hasText: text }).filter({ hasNotText: "Play again" });

for (const colorScheme of SCHEMES) {
  test(`home, lobby, profile and 404 render in the ${colorScheme} theme`, async ({ players }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    await page.emulateMedia({ colorScheme });

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

    await page.goto("/profile");
    await expect(page.getByText("Rookie rank")).toBeVisible();
    await expect(page.getByText("No games yet.")).toBeVisible();

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
    await expect(effect(alice.page, "confetti")).toBeAttached();
    await expect(toast(alice.page, "+30 XP")).toBeAttached();
    await expect(bob.page.getByText("Defeat")).toBeVisible();
    await expect(effect(bob.page, "confetti")).toHaveCount(0);
    const chip = alice.page.getByRole("banner").getByRole("progressbar", { name: /^Level 1: 30 of 50 XP/ });
    await expect(chip).toBeVisible();

    // The result survives a reload and a trip through history, as the same screen.
    await alice.page.reload();
    await expect(alice.page).toHaveURL(room);
    await expect(alice.page.getByRole("heading", { name: "You won!" })).toBeVisible();
    await expect(chip).toBeVisible();
    await alice.page.getByRole("link", { name: "Play again" }).click();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
    await alice.page.goBack();
    await expect(alice.page.getByText("Victory!")).toBeVisible();
    await alice.page.goForward();
    await expect(alice.page).toHaveURL("/games/rock-paper-scissors");
  });
}

test("a level-up bursts behind the new badge", async ({ players }) => {
  const alice = await players.open("alice");
  const bob = await players.open("bob");
  await aliceBeatsBob(alice, bob); // 30 XP

  await aliceBeatsBob(alice, bob); // 60 XP: level 2 starts at 50

  await expect(toast(alice.page, "Level up! You reached level 2")).toBeAttached();
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

  await aliceBeatsBob(alice, bob);
  await expect(toast(alice.page, "Level up! You reached level 2")).toBeAttached();
  expect(await animationCount(alice.page)).toBe(0);
  await expect(effect(alice.page, "level-up")).toHaveCount(0);
  await expect(alice.page.getByRole("heading", { name: "You won!" })).toBeVisible();
});

test("the game cards can be reached and opened with the keyboard, with a visible focus ring", async ({
  players,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard navigation is a desktop journey");
  const { page } = await players.open("visitor");
  await page.goto("/");
  await expect(page.locator("main li")).toHaveCount(3);
  const focusedName = () => page.evaluate(() => document.activeElement?.textContent ?? "");

  const names = [];
  for (let press = 0; press < 20 && names.length < 3; press++) {
    await page.keyboard.press("Tab");
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
