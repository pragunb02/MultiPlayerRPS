import { expect, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";

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
