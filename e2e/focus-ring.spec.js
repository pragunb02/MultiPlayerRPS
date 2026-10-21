import { createRoom, expect, test } from "./fixtures.js";

// Some screens move focus to their heading in code, so a screen reader starts reading there (CC-100). That focus
// is not the player's: the ring shows only when they use the keyboard. Chromium counts a focus made in code before
// any key or click as keyboard focus, so `:focus-visible` alone draws a large ring on page load.

/** The outline the focused element draws now. */
const ringOf = (page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { tag: document.activeElement.tagName, style: style.outlineStyle, width: style.outlineWidth };
  });

/** Moves on with the keyboard. Safari's Tab reaches only form fields unless Option is held (CC-184). */
const nextItem = (testInfo) => (testInfo.project.use.defaultBrowserType === "webkit" ? "Alt+Tab" : "Tab");

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

    await page.keyboard.press(nextItem(testInfo));
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

    await page.keyboard.press(nextItem(testInfo));
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
    const link = page
      .getByRole("region", { name: "Games" })
      .getByRole("link", { name: "Chess", exact: true });
    for (let press = 0; press < 20 && !(await link.evaluate((a) => a === document.activeElement)); press++) {
      await page.keyboard.press(nextItem(testInfo));
    }
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(chess).toBeFocused();
    expect(await ringOf(page)).toMatchObject({ tag: "H1", style: "solid", width: "3px" });
  });
});
