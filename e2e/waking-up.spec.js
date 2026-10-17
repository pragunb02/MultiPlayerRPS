import { expect, test } from "./fixtures.js";

// A visitor who has to wait (CC-232). The "Waking up the arcade" screen is in the HTML the server sends, so it shows
// while the app downloads, and the app shows the same screen while the session check waits for a slow server.
// A visit that is not slow never sees it, not even for a frame.

// Longer than the screen's delay (0.6 s), so a test sees it appear, and short enough to keep the suite fast.
const SLOW_MS = 2_500;
const TITLE = "Waking up the arcade…";

/** Holds every request matching `url` back for SLOW_MS before it goes to the server, like a server waking up. */
async function slowDown(page, url) {
  await page.route(url, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    await route.continue();
  });
}

/**
 * Records what the player sees on every frame the browser draws: which waking up screens are showing, or "none".
 * A frame that looks like the one before is not recorded again, so the record reads as a story. Only a styled
 * screen counts, so the moment before the stylesheet applies (when nothing is drawn yet) is not taken for a flash.
 */
async function watchForTheScreen(page) {
  await page.addInitScript(() => {
    window.wakeFrames = [];
    const look = () => {
      const showing = [...document.querySelectorAll("[data-wake]")]
        .filter((screen) => {
          const style = window.getComputedStyle(screen);
          return style.display === "grid" && style.visibility === "visible" && Number(style.opacity) > 0;
        })
        .map((screen) => screen.dataset.wake);
      const frame = showing.length === 0 ? "none" : showing.join(" ");
      if (window.wakeFrames.at(-1) !== frame) window.wakeFrames.push(frame);
      window.requestAnimationFrame(look);
    };
    window.requestAnimationFrame(look);
  });
}

const framesSeen = (page) => page.evaluate(() => window.wakeFrames);
const pageScreen = (page) => page.locator("[data-wake='page']");
const appScreen = (page) => page.locator("[data-wake='app']");
const homeIsReady = (page) => expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
// Not waiting for the page's load event, which comes only after a slowed script has run.
const AS_SOON_AS_IT_ARRIVES = { waitUntil: "commit" };

test.describe("a visitor who has to wait", () => {
  test("sees the waking up screen while the app downloads, until the app renders", async ({ players }) => {
    const { page } = await players.open("visitor");
    await slowDown(page, "**/assets/index-*.js");

    await page.goto("/", AS_SOON_AS_IT_ARRIVES);

    const screen = pageScreen(page);
    await expect(screen).toBeVisible();
    await expect(screen).toHaveAttribute("role", "status");
    await expect(screen).toContainText(TITLE);
    await expect(screen).toContainText("Getting the games ready.");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(screen).toHaveCount(0);
    await homeIsReady(page);
  });

  test("sees it inside the app while the server is slow to say who they are, until it answers", async ({
    players,
  }) => {
    const { page } = await players.open("visitor");
    await slowDown(page, "**/api/session");

    await page.goto("/");

    const screen = appScreen(page);
    await expect(screen).toBeVisible();
    await expect(screen).toHaveAttribute("role", "status");
    await expect(screen).toContainText(TITLE);
    await expect(screen).toContainText("Free servers take a moment to wake up.");
    await homeIsReady(page);
    await expect(screen).toHaveCount(0);
  });

  test("keeps seeing it without a gap when the app starts while the server is still slow", async ({
    players,
  }) => {
    const { page } = await players.open("visitor");
    await slowDown(page, "**/assets/index-*.js");
    await slowDown(page, "**/api/session");
    await watchForTheScreen(page);

    await page.goto("/", AS_SOON_AS_IT_ARRIVES);
    await expect(pageScreen(page)).toBeVisible();
    await expect(appScreen(page)).toBeVisible();
    await homeIsReady(page);
    await expect(appScreen(page)).toHaveCount(0);

    // The app knew the player was already looking at the screen, so its own copy skipped the delay: the page's
    // screen went straight to the app's, with no frame of nothing in between.
    expect(await framesSeen(page)).toEqual(["none", "page", "app", "none"]);
    await expect(page.locator("html")).toHaveClass(/wake-waited/);
  });
});

test.describe("a visitor who does not wait", () => {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    test(`never sees the waking up screen flash on a warm visit (reduced motion: ${reducedMotion})`, async ({
      players,
    }) => {
      const { page } = await players.open("visitor");
      await page.emulateMedia({ reducedMotion });
      await page.goto("/");
      await homeIsReady(page);
      await watchForTheScreen(page);

      await page.reload();
      await homeIsReady(page);
      await page.getByRole("link", { name: "Leaderboards" }).click();
      await expect(page).toHaveURL(/\/leaderboards\//);

      expect(await framesSeen(page)).toEqual(["none"]);
    });
  }
});
