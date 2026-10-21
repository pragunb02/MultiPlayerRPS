import { expect } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";

// The event themes in the browser tests (CC-328): a day inside each theme's window, the words it shows, and the
// owner's console to switch its flag. Each theme is on only when its flag is on and the browser's clock is inside
// its window (India days), so a test fixes the clock with Playwright and leaves the server's clock alone.

/** Each theme: its flag, a moment inside its window, and its English greeting. */
export const THEME_DAYS = Object.freeze({
  diwali_2026: Object.freeze({
    flag: "event_diwali_2026",
    day: "2026-11-08T12:00:00+05:30",
    greeting: "Happy Diwali from all of us at ClassiCade.",
  }),
  winter_2026: Object.freeze({
    flag: "event_winter_2026",
    day: "2026-12-25T12:00:00+05:30",
    greeting: "Winter nights, warm games.",
  }),
});

/** Opens the owner's browser, signed in. */
export async function openOwner(players) {
  const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
  await owner.page.goto("/login");
  await owner.page.getByLabel("Email").fill(OWNER.email);
  await owner.page.getByLabel("Password").fill(OWNER.password);
  await owner.page.getByRole("button", { name: "Log in" }).click();
  await expect(owner.page).toHaveURL("/");
  return owner;
}

/**
 * Sets a flag's rollout from the console, or with `"code"` sends it back to the rollout in code (off).
 *
 * @param {import("@playwright/test").Page} page  the owner's
 * @param {string} flag
 * @param {"on" | "off" | "code"} rollout
 */
export async function setRollout(page, flag, rollout) {
  await page.goto("/admin/flags");
  const card = page.getByRole("article", { name: flag });
  await expect(card).toBeVisible();
  if (rollout === "code") {
    const reset = card.getByRole("button", { name: "Use the rollout in code" });
    if ((await reset.count()) > 0) {
      await reset.click();
      await expect(reset).toHaveCount(0);
    }
    return;
  }
  await card.getByRole("combobox").selectOption(rollout);
  const saved = page.waitForResponse(
    (res) => res.url().endsWith(`/api/admin/flags/${flag}`) && res.request().method() === "PUT",
  );
  await card.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
}

/** Sets the page's clock to a day inside the theme's window. Timers keep running. */
export const onThemeDay = (page, theme) => page.clock.setFixedTime(new Date(THEME_DAYS[theme].day));

/**
 * Waits until a theme is fully on: its attribute on `<html>` and its chunk's tokens applied.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} theme
 */
export async function expectThemeOn(page, theme) {
  await expect(page.locator("html")).toHaveAttribute("data-event-theme", theme);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--event-ambient")))
    .toMatch(/url\(/);
}
