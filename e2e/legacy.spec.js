import { expect, test } from "./fixtures.js";
import { LEGACY_PLAYER } from "./personas.js";

// A player from the old app (until 2026-10-16): same email and password, account created at first login (CC-078).
test("a legacy player logs in with their old password and gets an account", async ({ players }) => {
  const old = await players.open("legacy player", { secrets: [LEGACY_PLAYER.email, LEGACY_PLAYER.password] });
  const { page } = old;

  await page.goto("/login?next=%2Fprofile");
  await page.getByLabel("Email").fill(LEGACY_PLAYER.email);
  await page.getByLabel("Password").fill(LEGACY_PLAYER.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/profile");
  await expect(page.getByRole("heading", { name: LEGACY_PLAYER.migratedUsername })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText(LEGACY_PLAYER.migratedUsername);
});

test("nobody can sign up with a legacy player's email", async ({ players }) => {
  const squatter = await players.open("squatter", { secrets: ["squatting password"] });
  squatter.expect(409, "/api/auth/signup");
  const { page } = squatter;

  await page.goto("/signup");
  await page.getByLabel("Username").fill("squatter");
  await page.getByLabel("Email").fill(LEGACY_PLAYER.email);
  await page.getByLabel("Password").fill("squatting password");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("That email can't be used")).toBeVisible();
  await expect(page).toHaveURL("/signup");
});
