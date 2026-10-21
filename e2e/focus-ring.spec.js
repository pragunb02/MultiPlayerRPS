import { createRoom, expect, nextItemKey, tabUntil, test } from "./fixtures.js";

// Some screens move focus to their heading in code, so a screen reader starts reading there (CC-100). That focus
// is not the player's: the ring shows only when they use the keyboard. Chromium counts a focus made in code before
// any key or click as keyboard focus, so `:focus-visible` alone draws a large ring on page load. A component that
// turns its own ring off (the pass-and-play board's region, whose board draws it) keeps it off.

/** The outline the focused element draws now. */
const ringOf = (page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { tag: document.activeElement.tagName, style: style.outlineStyle, width: style.outlineWidth };
  });

test.describe("focus moved in code draws no ring until the keyboard is used (CC-100)", () => {
  test.skip(({ isMobile }) => isMobile, "a keyboard journey");

  test("the invite chooser: no ring on its heading on load, a ring after Tab", async ({
    players,
  }, testInfo) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const { page } = await players.open("visitor");

    await page.goto(room.path);
    const heading = page.getByRole("heading", { name: "You're invited to play Tic Tac Toe" });
    await expect(heading).toBeFocused();
    expect(await ringOf(page)).toMatchObject({ tag: "H1", style: "none" });

    await page.keyboard.press(nextItemKey(testInfo));
    await expect(page.getByRole("button", { name: "Play as guest" })).toBeFocused();
    expect(await ringOf(page)).toMatchObject({ style: "solid", width: "3px" });
  });

  test("a challenge link: no ring on its heading on load, a ring after Tab", async ({
    players,
  }, testInfo) => {
    const alice = await players.open("alice");
    await alice.page.goto("/games/rock-paper-scissors");
    await alice.page.getByRole("button", { name: "Make a challenge link" }).click();
    const link = await alice.page.getByRole("textbox", { name: "Challenge link" }).inputValue();
    const { page } = await players.open("bob");

    await page.goto(new URL(link).pathname);
    const heading = page.getByRole("heading", { name: "You've been challenged to Rock Paper Scissors" });
    await expect(heading).toBeFocused();
    expect(await ringOf(page)).toMatchObject({ tag: "H1", style: "none" });

    await page.keyboard.press(nextItemKey(testInfo));
    expect(await ringOf(page)).toMatchObject({ style: "solid", width: "3px" });
  });

  test("a new page's heading: no ring after a click, a ring after Enter on a link", async ({
    players,
  }, testInfo) => {
    const { page } = await players.open("visitor");
    await page.goto("/");
    await page.getByRole("link", { name: "Chess", exact: true }).click();
    const chess = page.getByRole("heading", { level: 1, name: "Chess" });
    await expect(chess).toBeFocused();
    expect(await ringOf(page)).toMatchObject({ tag: "H1", style: "none" });

    await page.goto("/");
    const games = page.getByRole("region", { name: "Games" });
    await tabUntil(page, games.getByRole("link", { name: "Chess", exact: true }), testInfo);
    await page.keyboard.press("Enter");
    await expect(chess).toBeFocused();
    expect(await ringOf(page)).toMatchObject({ tag: "H1", style: "solid", width: "3px" });
  });

  test("the pass-and-play board's region keeps its ring off after Tab: the board draws it", async ({
    players,
  }, testInfo) => {
    const { page } = await players.open("Meena");
    await page.goto("/games/tic-tac-toe/pass-and-play");
    await page.getByRole("textbox", { name: "Player 1" }).fill("Asha");
    await page.getByRole("textbox", { name: "Player 2" }).fill("Ben");
    await tabUntil(page, page.getByRole("button", { name: "Start game" }), testInfo);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("region", { name: /Asha|Ben/ })).toBeFocused();
    expect(await ringOf(page)).toMatchObject({ tag: "SECTION", style: "none" });
  });
});
