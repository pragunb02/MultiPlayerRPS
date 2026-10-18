import { expect, formFactor, test } from "./fixtures.js";

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
    });
  }
}
