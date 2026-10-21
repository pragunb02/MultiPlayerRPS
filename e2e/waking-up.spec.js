import { expect, header, test } from "./fixtures.js";

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

/** Holds every request matching `url` back until the returned function is called, like a very slow network. */
async function holdBack(page, url) {
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

/**
 * Moves every animation on the page forward to `ms` after it started, as if the player had waited that long. The
 * screen's lines appear after delays of up to a minute and a half, far too long to sit through in a test.
 *
 * The animations come from the stylesheet. Before it applies, the unstyled screen already counts as visible, but no
 * browser draws it, and there is no animation to move yet. One moved then would start again from zero when the
 * stylesheet arrived, so this waits for the screen's own grid layout first (CC-275).
 */
async function waitAsIf(page, ms) {
  await expect(page.locator("[data-wake='page']")).toHaveCSS("display", "grid");
  await page.evaluate((time) => {
    for (const animation of document.getAnimations()) animation.currentTime = time;
  }, ms);
}

/** Whether the element is drawn right now, without waiting for it as `toBeVisible` would. */
const shownNow = (locator) =>
  locator.evaluate((element) => getComputedStyle(element).visibility === "visible");

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
const homeIsReady = async (page) =>
  expect((await header(page)).getByRole("link", { name: "Log in" })).toBeVisible();
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

  // The app's screen lies over the page and takes no room in it. When it took room, the lobby jumped up by about
  // 340 px on a phone as it went, a layout shift of 0.37 (CC-322).
  test("sees the lobby stay where it is when the screen goes", async ({ players }) => {
    const { page } = await players.open("visitor");
    await slowDown(page, "**/api/session");

    await page.goto("/games/chess");

    await expect(appScreen(page)).toBeVisible();
    const heading = page.getByRole("heading", { level: 1, name: "Chess" });
    const before = await heading.boundingBox();
    // Not homeIsReady: on a phone it opens the menu, which moves the page on purpose.
    await expect(appScreen(page)).toHaveCount(0);

    expect((await heading.boundingBox()).y).toBe(before.y);
  });
});

test.describe("a visitor who waits a long time", () => {
  test("keeps the still waking up line when the app starts after it appeared", async ({ players }) => {
    const { page } = await players.open("visitor");
    const startApp = await holdBack(page, "**/assets/index-*.js");
    const answerSession = await holdBack(page, "**/api/session");

    await page.goto("/", AS_SOON_AS_IT_ARRIVES);
    await expect(pageScreen(page)).toBeVisible();
    await waitAsIf(page, 11_000);
    expect(await shownNow(pageScreen(page).locator(".wake-later"))).toBe(true);
    startApp();
    await expect(appScreen(page)).toBeVisible();

    // The line stays on screen as the app takes over, instead of going away for another ten seconds.
    expect(await shownNow(appScreen(page).locator(".wake-later"))).toBe(true);
    answerSession();
    await homeIsReady(page);
  });

  test("is offered a reload when the app never loads, and the reload brings the app", async ({ players }) => {
    const { page } = await players.open("visitor");
    // The main script never arrives, as on a dropped connection. Aborted, so the check for failed requests that
    // every test makes does not count this one, which the test causes on purpose.
    await page.route("**/assets/index-*.js", (route) => route.abort("aborted"));

    await page.goto("/");
    await expect(pageScreen(page)).toBeVisible();
    // Held back until long after the slowest wake, so nobody is told to reload a page that is only slow.
    expect(await shownNow(pageScreen(page).locator(".wake-stuck"))).toBe(false);
    await waitAsIf(page, 95_000);
    const reload = pageScreen(page).getByRole("link", { name: "Reload the page" });
    await expect(reload).toBeVisible();

    await page.unroute("**/assets/index-*.js");
    await reload.click();
    await homeIsReady(page);
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
