import { expect, formFactor, header, test, WIDE_HEADER_MIN_WIDTH } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";
import { longNameAccount } from "./personas.js";

// The header from 320 to 1440 px (CC-324). The October audit found every state scrolling sideways at 768, because
// the compact header only began under 640 px. Now it is compact under 64rem and one row from there, and no width
// may be wider than the screen, for a visitor, a guest, an account with the longest name and the owner.

const WIDTHS = [320, 360, 390, 412, 640, 768, 900, 1023, 1024, 1100, 1280, 1440];

/** Nothing on the page, and nothing in the header, reaches past the right edge. The header is one row. */
async function expectFitsAt(page, width, who) {
  await page.setViewportSize({ width, height: 800 });
  // The layout follows the width on the next render, so wait for it before measuring.
  await expect(page.getByRole("banner").getByRole("button", { name: /^Menu/ })).toHaveCount(
    width < WIDE_HEADER_MIN_WIDTH ? 1 : 0,
  );
  const seen = await page.evaluate(() => {
    const banner = document.querySelector("header");
    const past = [...banner.querySelectorAll("*")]
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .map((element) => `<${element.tagName.toLowerCase()}> "${element.textContent.trim().slice(0, 20)}"`);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      height: banner.getBoundingClientRect().height,
      past,
    };
  });
  const where = `${who} at ${width}: ${JSON.stringify(seen)}`;
  expect(seen.scrollWidth, where).toBeLessThanOrEqual(seen.clientWidth);
  expect(seen.past, where).toEqual([]);
  // One row: 3.5rem compact or 4.5rem wide, plus the borders. A wrapped row would be at least twice that.
  expect(seen.height, where).toBeLessThanOrEqual(width < WIDE_HEADER_MIN_WIDTH ? 64 : 80);
}

async function logIn(page, { email, password }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator("main").getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("the header fits every width (CC-324)", () => {
  test("for a visitor, a guest, the longest name and the owner, from 320 to 1440 px", async ({
    players,
  }, testInfo) => {
    test.skip(formFactor(testInfo) !== "desktop", "one browser resizes through every width");
    test.setTimeout(90_000);
    const visitor = await players.open("visitor");
    await visitor.page.goto("/");

    const guest = await players.open("guest");
    await guest.page.goto("/");
    await guest.page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(guest.page.getByRole("banner").locator('[data-cc-identity="guest"]')).toHaveCount(1);

    const account = longNameAccount();
    const long = await players.open("long", { secrets: [account.email, account.password] });
    await long.page.goto("/signup");
    await long.page.getByLabel("Username").fill(account.username);
    await long.page.getByLabel("Email").fill(account.email);
    await long.page.getByLabel("Password").fill(account.password);
    await long.page.getByRole("button", { name: "Create account" }).click();
    await expect(long.page).toHaveURL("/");

    const owner = await players.open("owner", { secrets: [OWNER.email, OWNER.password] });
    await logIn(owner.page, OWNER);
    await expect(owner.page.getByRole("banner").getByRole("link", { name: "Console" })).toHaveCount(1);

    for (const [who, page] of [
      ["visitor", visitor.page],
      ["guest", guest.page],
      ["longest name", long.page],
      ["owner", owner.page],
    ]) {
      for (const width of WIDTHS) {
        await expectFitsAt(page, width, who);
      }
    }
    // The longest name is cut with an ellipsis in the row, and its whole text is still there to be read.
    await long.page.setViewportSize({ width: 1024, height: 800 });
    const name = long.page.getByRole("banner").locator('[data-cc-identity="user"]');
    await expect(name).toHaveText(account.username);
    await expect(name).toHaveAttribute("title", account.username);
    await expect(long.page.getByRole("button", { name: account.username })).toBeVisible();
  });
});

test.describe("the compact header (CC-259, CC-324)", () => {
  test("is one row on a phone, with the grouped menu behind one button, and works from the keyboard", async ({
    players,
  }, testInfo) => {
    test.skip(formFactor(testInfo) !== "mobile", "the phone header is checked on the mobile project");
    const { page } = await players.open("visitor");
    await page.goto("/");
    const banner = page.getByRole("banner");
    const toggle = banner.getByRole("button", { name: "Menu" });
    const login = banner.getByRole("link", { name: "Log in" });
    expect((await banner.boundingBox()).height).toBeLessThanOrEqual(64);
    await expect(login).toBeHidden();

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const play = banner.getByRole("group", { name: "Play" });
    await expect(play.getByRole("link", { name: "Games" })).toBeFocused();
    for (const group of ["Play", "You", "Settings"]) {
      await expect(banner.getByRole("group", { name: group })).toBeVisible();
    }
    await expect(login).toBeVisible();
    await expect(banner.getByRole("slider", { name: "Volume" })).toBeVisible();
    // Each row is a full-width target, at least 44 px tall.
    expect(
      (await play.getByRole("link", { name: "Leaderboards" }).boundingBox()).height,
    ).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expect(login).toBeHidden();
  });

  test("marks Leaderboards as the current page on every board", async ({ players }) => {
    const { page } = await players.open("visitor");
    for (const board of ["weekly", "chess"]) {
      await page.goto(`/leaderboards/${board}`);
      const link = (await header(page)).getByRole("link", { name: "Leaderboards" });
      await expect(link).toHaveAttribute("aria-current", "page");
    }
  });
});

test.describe("the wide header (CC-324)", () => {
  test("opens the sound options and the account menu from the keyboard, and Escape closes each", async ({
    players,
  }, testInfo) => {
    test.skip(formFactor(testInfo) !== "desktop", "the wide header is checked on the desktop project");
    const guest = await players.open("guest");
    const { page } = guest;
    await page.goto("/");
    await page.getByRole("button", { name: "Play as a guest" }).click();
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("button", { name: "Menu" })).toHaveCount(0);

    const more = banner.getByRole("button", { name: "Sound options" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(banner.getByRole("slider", { name: "Volume" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();
    await expect(banner.getByRole("slider", { name: "Volume" })).toHaveCount(0);

    const account = banner.locator('[data-cc-control="header.account"]');
    // Focused directly: Safari's Tab skips buttons and links unless the player turns that on.
    await account.focus();
    await page.keyboard.press("Enter");
    await expect(banner.getByRole("link", { name: "Profile" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(account).toHaveAttribute("aria-expanded", "false");
    await expect(account).toBeFocused();
  });
});
