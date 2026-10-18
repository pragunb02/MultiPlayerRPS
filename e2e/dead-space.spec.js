import { expect, formFactor, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";
import { newAccount } from "./personas.js";

// No screen leaves a large empty area (CC-259). Each check measures the page instead of comparing pictures: grid
// tracks against the number of items, card heights against their content, and how much of the width the content
// uses. The laptop runs at 1280 x 720. The phone runs at 390 x 844 and at 360 x 800, the smallest screen we
// design for (ADR-049).

const SIZES = Object.freeze({
  desktop: [{ width: 1280, height: 720 }],
  mobile: [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ],
});

/** Opens a visitor's browser at one of the screen sizes of this run. */
async function visitorAt(players, size) {
  const visitor = await players.open("visitor");
  await visitor.page.setViewportSize(size);
  return visitor;
}

/** The number of columns a grid draws, from its computed `grid-template-columns`. Collapsed columns are 0px. */
const trackCount = (locator) =>
  locator.evaluate(
    (element) =>
      getComputedStyle(element)
        .gridTemplateColumns.split(" ")
        .filter((track) => parseFloat(track) > 0).length,
  );

/** The empty space at the bottom of a card: its height minus the bottom of its last child. */
const emptyBelowContent = (locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const last = element.lastElementChild.getBoundingClientRect();
    return box.bottom - last.bottom;
  });

for (const form of Object.keys(SIZES)) {
  for (const size of SIZES[form]) {
    test.describe(`at ${size.width} x ${size.height}`, () => {
      /** A test that runs only on the project of this screen size, in a visitor's browser of that size. */
      const screen = (name, body) =>
        test(name, async ({ players }, testInfo) => {
          test.skip(formFactor(testInfo) !== form, `${form} sizes run on the ${form} project`);
          await body(await visitorAt(players, size));
        });

      screen("home: the games fill their row, with no empty column beside them", async ({ page }) => {
        await page.goto("/");
        const grid = page.getByRole("list").filter({ has: page.getByRole("link", { name: "Chess" }) });
        await expect(grid).toBeVisible();
        const games = await grid.getByRole("listitem").count();

        const tracks = await trackCount(grid);
        const gridBox = await grid.boundingBox();
        const lastCard = await grid.getByRole("listitem").last().boundingBox();

        expect(tracks).toBeLessThanOrEqual(games);
        expect(gridBox.x + gridBox.width - (lastCard.x + lastCard.width)).toBeLessThan(2);
        if (form === "desktop") {
          expect(tracks).toBe(Math.min(games, 4));
          expect(gridBox.width).toBeGreaterThan(size.width * 0.8);
        }
      });

      screen("lobby: each card is as tall as its content", async ({ page }) => {
        for (const slug of ["rock-paper-scissors", "chess"]) {
          await page.goto(`/games/${slug}`);
          for (const name of ["Play a friend", "Join a friend"]) {
            const card = page
              .locator("main")
              .locator("div, form")
              .filter({
                has: page.getByRole("heading", { level: 2, name, exact: true }),
              });
            // The card's own padding and border, and nothing more.
            expect(await emptyBelowContent(card.last()), `${slug}: ${name}`).toBeLessThan(40);
          }
        }
      });

      screen("lobby: a How to play strip of three steps under the cards", async ({ page }) => {
        for (const slug of ["rock-paper-scissors", "tic-tac-toe", "chess"]) {
          await page.goto(`/games/${slug}`);
          const strip = page.getByRole("region", { name: "How to play" });
          const steps = strip.getByRole("listitem");

          await expect(steps).toHaveCount(3);
          const cards = await page.getByRole("heading", { level: 2, name: "Join a friend" }).boundingBox();
          const stripBox = await strip.boundingBox();
          expect(stripBox.y, slug).toBeGreaterThan(cards.y);
          if (form === "desktop") {
            // Three steps side by side, across the page.
            expect(await trackCount(strip.getByRole("list")), slug).toBe(3);
            expect(stripBox.width, slug).toBeGreaterThan(size.width * 0.8);
          }
        }
      });

      screen("visitor profile: a heading, art, a preview of the card and two ways in", async ({ page }) => {
        await page.goto("/profile");
        const profile = page.getByRole("region", { name: "Your profile" });

        await expect(profile.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible();
        await expect(profile.locator("svg").first()).toBeVisible();
        await expect(profile.getByRole("list", { name: "What your card will show" })).toBeVisible();
        await expect(profile.getByRole("button", { name: "Play as a guest" })).toBeVisible();
        await expect(profile.getByRole("link", { name: "Log in" })).toBeVisible();
        const box = await profile.boundingBox();
        expect(box.height).toBeGreaterThan(250);
        if (form === "desktop") {
          expect(box.width).toBeGreaterThan(size.width * 0.8);
        }
      });

      screen(
        "leaderboards: a board with few players has the way onto it beside or under it",
        async ({ page }) => {
          await page.goto("/leaderboards/overall");
          const card = page
            .locator("div")
            .filter({ has: page.getByRole("heading", { level: 2, name: "Overall XP" }) });
          const panel = page.getByRole("complementary", { name: "How to get on the board" });
          await expect(page.getByText("Loading the leaderboard…")).toHaveCount(0);
          // The server shares one database with every other test, so the board may already be full here.
          const listed = await page
            .getByRole("list", { name: "Overall XP rankings" })
            .getByRole("listitem")
            .count();

          const area = page.getByRole("main").locator("section");
          const areaBox = await area.boundingBox();
          if (listed < 25) {
            await expect(panel).toBeVisible();
            await expect(panel.getByRole("link", { name: "Play a game" })).toBeVisible();
            const cardBox = await card.last().boundingBox();
            const panelBox = await panel.boundingBox();
            if (form === "desktop") {
              // Side by side, and together as wide as the page.
              expect(Math.abs(panelBox.y - cardBox.y)).toBeLessThan(2);
              expect(panelBox.x + panelBox.width - areaBox.x).toBeGreaterThan(areaBox.width - 2);
            } else {
              expect(panelBox.y).toBeGreaterThan(cardBox.y + cardBox.height);
            }
          } else {
            await expect(panel).toHaveCount(0);
          }
          if (form === "desktop") {
            expect(areaBox.width).toBeGreaterThan(size.width * 0.8);
          }
        },
      );

      screen("header: one row, with Log in and Sign up in the menu on a phone", async ({ page }) => {
        await page.goto("/");
        const banner = page.getByRole("banner");
        const toggle = banner.getByRole("button", { name: "Menu" });
        const login = banner.getByRole("link", { name: "Log in" });
        await expect(banner.getByRole("navigation", { name: "Main" })).toBeVisible();

        if (form === "desktop") {
          await expect(toggle).toBeHidden();
          await expect(login).toBeVisible();
          await expect(banner.getByRole("link", { name: "Sign up" })).toBeVisible();
          return;
        }
        // One row: the header is no taller than its tallest item plus its padding.
        expect((await banner.boundingBox()).height).toBeLessThanOrEqual(64);
        await expect(login).toBeHidden();
        const nav = await banner.getByRole("navigation", { name: "Main" }).boundingBox();
        expect(nav.x + nav.width).toBeLessThanOrEqual((await toggle.boundingBox()).x);

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(banner.getByRole("button", { name: /^Sound o/ })).toBeFocused();
        await expect(login).toBeVisible();
        await expect(banner.getByRole("link", { name: "Sign up" })).toBeVisible();
        await expect(banner.getByRole("slider", { name: "Volume" })).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(toggle).toBeFocused();
        await expect(login).toBeHidden();
      });
    });
  }
}

/** Logs a person in from the login page, and waits for the home page. */
async function logIn(page, { email, password }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

/** The phone header's height, and whether the menu button shares the row with the navigation. */
async function headerRow(page) {
  const banner = page.getByRole("banner");
  const nav = await banner.getByRole("navigation", { name: "Main" }).boundingBox();
  const toggle = await banner.getByRole("button", { name: /^Menu/ }).boundingBox();
  return { height: (await banner.boundingBox()).height, sameRow: Math.abs(nav.y - toggle.y) < toggle.height };
}

test.describe("phone header with more links, at 360 x 800", () => {
  const SMALLEST = { width: 360, height: 800 };

  test("stays one row for an account holder (three links) and for an admin (four links)", async ({
    players,
  }, testInfo) => {
    test.skip(formFactor(testInfo) !== "mobile", "the phone header is checked on the mobile project");
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    await riya.page.setViewportSize(SMALLEST);
    await riya.page.goto("/signup");
    await riya.page.getByLabel("Username").fill(account.username);
    await riya.page.getByLabel("Email").fill(account.email);
    await riya.page.getByLabel("Password").fill(account.password);
    await riya.page.getByRole("button", { name: "Create account" }).click();
    await expect(riya.page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(3);

    const owner = await players.open("owner", { secrets: [OWNER.email, OWNER.password] });
    await owner.page.setViewportSize(SMALLEST);
    await logIn(owner.page, OWNER);
    await expect(owner.page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(4);

    for (const [who, page] of [
      ["account holder", riya.page],
      ["admin", owner.page],
    ]) {
      const row = await headerRow(page);
      expect(row.height, who).toBeLessThanOrEqual(64);
      expect(row.sameRow, who).toBe(true);
    }
  });
});
