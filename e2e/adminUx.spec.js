import { expect, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";

// The owner's UX page (CC-177) and its Week view (CC-313): the owner turns the two console flags on, reads every
// section for the default range and for a new one, opens the week, and sends the flags back to code. The daily
// totals are seeded by server.mjs (uxTotals.js), for the days before today on the real clock.

const FLAGS = Object.freeze(["console_ux", "console_ux_week"]);
const SECTIONS = Object.freeze([
  ["Funnels", "Visit to play"],
  ["Clicks", "Dead click hotspots"],
  ["Errors", "Errors by build"],
  ["Speed", "Page speed by screen and device"],
  ["Latency", "Wait per control"],
  ["Interruptions", "The interruption budget"],
]);

async function logIn(player, { email, password }) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill(password);
  await player.page.getByRole("button", { name: "Log in" }).click();
  await expect(player.page).toHaveURL("/");
}

const setFlags = (page, rollout) =>
  Promise.all(
    FLAGS.map((name) =>
      rollout === undefined
        ? page.request.delete(`/api/admin/flags/${name}`)
        : page.request.put(`/api/admin/flags/${name}`, { data: { rollout } }),
    ),
  );

test.describe("the owner's UX page", () => {
  // The flags' rollouts are one setting on the shared server, so one device changes them at a time.
  test.skip(({ isMobile }) => isMobile, "the rollout is shared, so the phone run would race the desktop one");

  test("the owner reads the UX page for a range", async ({ players }) => {
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    const { page } = owner;
    await logIn(owner, OWNER);
    try {
      (await setFlags(page, "on")).forEach((res) => expect(res.status()).toBe(200));

      await page.goto("/admin");
      await page
        .getByRole("navigation", { name: "Console sections" })
        .getByRole("link", { name: /^UX/ })
        .click();
      await expect(page).toHaveURL(/\/admin\/ux$/);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
      const sections = page.getByRole("navigation", { name: "UX sections" });

      // The default range: the last 7 full India days, every section loads.
      for (const [tab, figure] of SECTIONS) {
        await sections.getByRole("link", { name: tab, exact: true }).click();
        await expect(page.getByRole("figure", { name: figure, exact: true })).toBeVisible();
      }
      await expect(page.getByRole("figure", { name: "The interruption budget" })).toContainText("Amber");

      // A new range: the last 28 full days, and every section loads for it.
      await page.getByRole("link", { name: "Last 28 days" }).click();
      await expect(page).toHaveURL(
        /\/admin\/ux\/interruptions\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
      );
      const range = new URL(page.url()).search;
      for (const [tab, figure] of SECTIONS) {
        await sections.getByRole("link", { name: tab, exact: true }).click();
        await expect(page).toHaveURL(`/admin/ux/${tab.toLowerCase()}${range}`);
        await expect(page.getByRole("figure", { name: figure, exact: true })).toBeVisible();
      }
      // Small groups are never shown as numbers.
      await sections.getByRole("link", { name: "Clicks", exact: true }).click();
      await expect(page.getByRole("figure", { name: "Dead click hotspots" })).not.toContainText(/\b[1-4] \(/);

      // The week, with its eight sections and the badge on the console's tab.
      await sections.getByRole("link", { name: "Week", exact: true }).click();
      await expect(
        page.getByRole("heading", { level: 2, name: "8. Flags ramping with a friction guardrail" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Console sections" })
          .getByRole("link", { name: /UX (Red|Amber)/ }),
      ).toBeVisible();
    } finally {
      await setFlags(page, undefined);
    }

    // Back to code (off): the tab is gone and the API answers the ordinary 404.
    await page.goto("/admin/flags");
    await expect(
      page.getByRole("navigation", { name: "Console sections" }).getByRole("link", { name: /^UX/ }),
    ).toHaveCount(0);
    expect((await page.request.get("/api/admin/ux?section=funnels")).status()).toBe(404);
  });

  test("anyone but the owner gets the ordinary 404, page and API alike", async ({ players }) => {
    const guest = await players.open("guest");
    const { page } = guest;
    await page.goto("/");
    await page.getByRole("button", { name: "Play as a guest" }).click();
    await expect(page.getByRole("banner").getByText(/^Guest-/)).toBeVisible();

    guest.expect(404, "/admin/ux/week");
    const answer = await page.goto("/admin/ux/week");
    expect(answer.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect((await page.request.get("/api/admin/ux?section=week")).status()).toBe(404);
  });
});
