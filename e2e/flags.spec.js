import AxeBuilder from "@axe-core/playwright";
import { THEME_DAYS, expectThemeOn, onThemeDay, openOwner, setRollout } from "./eventThemes.js";
import { expect, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";

// The axe rules of the CC-183 scan (accessibility.spec.js): every rule in light, the colour rules in dark.
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const AXE_COLOUR_RULES = ["color-contrast", "link-in-text-block"];

// Feature flags in the owner console (CC-312, ADR-073): the owner turns the canary flag on without a deploy, sees
// it reach the page, counts its success, and sends it back to the rollout in code. Players never see the tab.

async function logIn(player, { email, password }) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill(password);
  await player.page.getByRole("button", { name: "Log in" }).click();
  await expect(player.page).toHaveURL("/");
}

test.describe("feature flags", () => {
  // The flag's rollout is one setting on the shared server, so one device changes it at a time.
  test.skip(({ isMobile }) => isMobile, "the rollout is shared, so the phone run would race the desktop one");

  test("the owner ramps a flag from the console, sees it reach the page, and sends it back to code", async ({
    players,
  }) => {
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    const { page } = owner;
    await logIn(owner, OWNER);

    await page.goto("/admin/flags");
    await expect(page).toHaveTitle("Flags · Owner console · ClassiCade");
    const flag = page.getByRole("article", { name: "console_flag_check" });
    await expect(flag.getByText("Console admins only")).toBeVisible();
    await expect(page.getByText(/The console_flag_check flag is on for you/)).toHaveCount(0);

    await flag.getByRole("combobox").selectOption("on");
    const saved = page.waitForResponse(
      (res) => res.url().endsWith("/api/admin/flags/console_flag_check") && res.request().method() === "PUT",
    );
    await flag.getByRole("button", { name: "Save" }).click();
    expect((await saved).status()).toBe(200);
    await expect(flag.getByRole("button", { name: "Use the rollout in code" })).toBeVisible();

    await page.reload();
    await expect(page.getByText(/The console_flag_check flag is on for you/)).toBeVisible();
    const counted = page.waitForResponse((res) =>
      res.url().endsWith("/api/flags/console_flag_check/success"),
    );
    await page.getByRole("button", { name: "It works" }).click();
    expect((await counted).status()).toBe(204);

    const answer = await page.request.get("/api/flags?names=console_flag_check");
    expect(answer.headers()["cache-control"]).toBe("no-store");
    expect(await answer.json()).toEqual({ flags: { console_flag_check: true } });

    await flag.getByRole("button", { name: "Use the rollout in code" }).click();
    await expect(flag.getByRole("button", { name: "Use the rollout in code" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("article", { name: "console_flag_check" })).toBeVisible();
    await expect(page.getByText(/The console_flag_check flag is on for you/)).toHaveCount(0);
  });

  test("a guest gets the console's 404 and only booleans from the flags answer", async ({ players }) => {
    const guest = await players.open("guest");
    const { page } = guest;
    await page.goto("/");
    await page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(page.getByRole("banner").getByText(/^Guest-/)).toBeVisible();

    const admin = await page.request.get("/api/admin/flags");
    expect(admin.status()).toBe(404);
    const answer = await page.request.get("/api/flags?names=console_flag_check");
    expect(await answer.json()).toEqual({ flags: { console_flag_check: false } });
    const refused = await page.request.put("/api/admin/flags/console_flag_check", {
      data: { rollout: "on" },
    });
    expect(refused.status()).toBe(404);
  });
});

// Event themes (CC-328): a theme is on when its flag is on and the browser's day (India) is inside its window. The
// rollout is one setting on the shared server, so these run one at a time, on the laptop only, and send each flag
// back to its rollout in code (off) at the end.
test.describe("event themes", () => {
  test.skip(({ isMobile }) => isMobile, "the rollout is shared, so the phone run would race the desktop one");
  test.describe.configure({ mode: "serial" });

  const THEMES = Object.keys(THEME_DAYS);
  /** The probe's sizes: CC-154's widths and 200 % zoom of 1280 × 720 (CC-154 D1). */
  const SIZES = [
    ...[320, 360, 390, 768, 1024, 1280].map((width) => ({ width, height: 800 })),
    { width: 640, height: 360 },
  ];

  /** Turns every theme's flag on for the test, and back to its rollout in code after it. */
  async function withThemesOn(players, run) {
    const owner = await openOwner(players);
    for (const theme of THEMES) await setRollout(owner.page, THEME_DAYS[theme].flag, "on");
    try {
      await run(owner);
    } finally {
      for (const theme of THEMES) await setRollout(owner.page, THEME_DAYS[theme].flag, "code");
    }
  }

  test("the Diwali theme follows its flag and its window", async ({ players }) => {
    const visitor = await players.open("visitor");
    const { page } = visitor;
    await onThemeDay(page, "diwali_2026");
    await page.goto("/");
    // Off in code: nothing on Lakshmi Puja itself until the owner turns the flag on.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-event-theme");

    await withThemesOn(players, async () => {
      await page.reload();
      await expectThemeOn(page, "diwali_2026");
      const hero = page.locator("main section").first();
      await expect(
        hero.getByText("Diwali ki shubhkamnayein! Roshni aur khushiyan tumhare saath."),
      ).toBeVisible();
      await expect(hero.getByText(THEME_DAYS.diwali_2026.greeting)).toBeVisible();
      await expect(hero.locator("[data-event-greeting] + h1")).toHaveCount(1);
      const answer = await page.request.get("/api/flags?names=event_diwali_2026");
      expect(await answer.json()).toEqual({ flags: { event_diwali_2026: true } });

      // The day after Bhai Dooj, India time: the lamps come down without a deploy.
      await page.clock.setFixedTime(new Date("2026-11-12T00:30:00+05:30"));
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("html")).not.toHaveAttribute("data-event-theme");
      await expect(page.getByText(THEME_DAYS.diwali_2026.greeting)).toHaveCount(0);
    });
  });

  test("themes pass the layout probe", async ({ players }) => {
    test.setTimeout(180_000);
    await withThemesOn(players, async () => {
      for (const theme of THEMES) {
        const { page } = await players.open(`visitor ${theme}`);
        await onThemeDay(page, theme);
        for (const path of ["/", "/games/chess"]) {
          for (const size of SIZES) {
            await page.setViewportSize(size);
            await page.goto(path);
            await expectThemeOn(page, theme);
            const at = `${theme} on ${path} at ${size.width} × ${size.height}`;
            const fits = await page.evaluate(() => ({
              wider: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              // Every line of the greeting fits its box: nothing clipped, nothing wider than it.
              clipped: [
                ...document.querySelectorAll("[data-event-greeting], [data-event-greeting] *"),
              ].filter((node) => node.scrollWidth > node.clientWidth + 1).length,
            }));
            expect(fits, at).toEqual({ wider: 0, clipped: 0 });
            if (path === "/") await expect(page.getByText(THEME_DAYS[theme].greeting), at).toBeVisible();
          }
        }
      }
    });
  });

  test("axe: event themes", async ({ players }) => {
    test.setTimeout(180_000);
    await withThemesOn(players, async () => {
      for (const theme of THEMES) {
        const { page } = await players.open(`visitor ${theme}`);
        await onThemeDay(page, theme);
        await page.goto("/");
        await expectThemeOn(page, theme);
        // The entrance burst plays once on the home page: its canvas is decoration, hidden from screen readers.
        const canvas = page.locator(`canvas[data-effect="${theme}"]`);
        await expect(canvas).toHaveAttribute("aria-hidden", "true");
        await expect(canvas).toHaveCount(0);
        for (const path of ["/", "/games/chess"]) {
          await page.goto(path);
          await expectThemeOn(page, theme);
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
            const axe = new AxeBuilder({ page });
            const { violations } = await (
              colorScheme === "light" ? axe.withTags(AXE_TAGS) : axe.withRules(AXE_COLOUR_RULES)
            ).analyze();
            expect(
              violations
                .filter((violation) => ["serious", "critical"].includes(violation.impact))
                .map(
                  (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`,
                ),
              `${theme} on ${path}, ${colorScheme}`,
            ).toEqual([]);
          }
        }
      }
    });
  });

  test("the owner previews a theme in this tab only", async ({ players }) => {
    const owner = await openOwner(players);
    const { page } = owner;
    await page.goto("/admin/flags");
    const card = page.getByRole("article", { name: "event_diwali_2026" });
    await card.getByRole("button", { name: "Preview in this tab" }).click();
    // Outside the window and with the flag off, this tab shows the theme.
    await expectThemeOn(page, "diwali_2026");
    await page.getByRole("banner").getByRole("link", { name: "ClassiCade home" }).click();
    await expect(page.getByText(THEME_DAYS.diwali_2026.greeting)).toBeVisible();

    // Not another tab, and not after a reload: it is stored nowhere.
    const other = await owner.openTab();
    await other.goto("/");
    await expect(other.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(other.locator("html")).not.toHaveAttribute("data-event-theme");
    await other.close();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-event-theme");
    await expect(page.getByText(THEME_DAYS.diwali_2026.greeting)).toHaveCount(0);
  });
});
