import { THEME_DAYS, expectThemeOn, onThemeDay, openOwner, setRollout } from "./eventThemes.js";
import { expect, test } from "./fixtures.js";

// Screenshot baselines of the event themes (CC-328, AC-9): home and a lobby with no theme, with Diwali and with
// the winter theme, each light and dark, with reduced motion and without it (after the entrance burst, which is
// still once it ends). Run in the pinned container like every baseline: `npm run test:visual` (CC-155).

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

// The rollout is one setting on the visual job's server, so the themes' flags are on for this file only, one test
// after another.
test.describe.configure({ mode: "serial" });

test("event themes", async ({ players }) => {
  test.setTimeout(240_000);
  const owner = await openOwner(players);
  for (const { flag } of Object.values(THEME_DAYS)) await setRollout(owner.page, flag, "on");
  try {
    for (const state of STATES) {
      for (const [motion, reducedMotion] of Object.entries(MOTIONS)) {
        const { page } = await players.open(`visitor ${state} ${motion}`);
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
            await page.emulateMedia({ colorScheme, reducedMotion });
            await expect(page).toHaveScreenshot(
              `theme-${state}-${screen.name}-${motion}-${colorScheme}.png`,
              {
                fullPage: true,
              },
            );
          }
        }
      }
    }
  } finally {
    for (const { flag } of Object.values(THEME_DAYS)) await setRollout(owner.page, flag, "code");
  }
});
