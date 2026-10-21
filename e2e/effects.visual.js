import { THEME_DAYS, expectThemeOn, onThemeDay } from "./eventThemes.js";
import { expect, test } from "./fixtures.js";

// Screenshot baselines of the event themes (CC-328, AC-9): home and a lobby with no theme, with Diwali and with
// the winter theme, each light and dark, with reduced motion and without it (after the entrance burst, which is
// still once it ends). Run in the pinned container like every baseline: `npm run test:visual` (CC-155).
//
// The laptop and the phone run at the same time, and a flag's rollout is one setting on the server, so this file
// does not switch flags: each browser is answered that the themes' flags are on. flags.spec.js checks the real
// path from the console to the page.

const SCHEMES = Object.freeze(["light", "dark"]);
const STATES = Object.freeze(["none", ...Object.keys(THEME_DAYS)]);
const MOTIONS = Object.freeze({ reduced: "reduce", full: "no-preference" });
const SCREENS = Object.freeze([
  { name: "home", path: "/", ready: (page) => page.getByRole("heading", { level: 1 }) },
  {
    name: "lobby-chess",
    path: "/games/chess",
    ready: (page) => page.getByRole("combobox", { name: /time control/i }),
  },
]);

/** Answers the page's flags question with every asked flag on. */
const flagsOn = (page) =>
  page.route("**/api/flags?*", (route) => {
    const names = new URL(route.request().url()).searchParams.get("names").split(",");
    return route.fulfill({ json: { flags: Object.fromEntries(names.map((name) => [name, true])) } });
  });

test("event themes", async ({ players }) => {
  test.setTimeout(240_000);
  for (const state of STATES) {
    for (const [motion, reducedMotion] of Object.entries(MOTIONS)) {
      const { page } = await players.open(`visitor ${state} ${motion}`);
      await flagsOn(page);
      await page.emulateMedia({ reducedMotion });
      // Outside every window, the page has its usual look; inside one, the theme's.
      await page.clock.setFixedTime(new Date("2026-10-21T12:00:00+05:30"));
      if (state !== "none") await onThemeDay(page, state);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(screen.ready(page)).toBeVisible();
        if (state === "none") await expect(page.locator("html")).not.toHaveAttribute("data-event-theme");
        else await expectThemeOn(page, state);
        // The entrance burst lasts at most 1.5 s, then the page is still.
        await expect(page.locator("canvas")).toHaveCount(0);
        await page.mouse.move(0, 0);
        await page.evaluate(
          () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
        );
        for (const colorScheme of SCHEMES) {
          // The page loaded and its burst played with this motion setting; the picture is taken at rest with
          // motion reduced, because the app's own art twinkles under full motion (visual.spec.js checks motion).
          await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
          await expect(page).toHaveScreenshot(`theme-${state}-${screen.name}-${motion}-${colorScheme}.png`, {
            fullPage: true,
          });
        }
      }
    }
  }
});
