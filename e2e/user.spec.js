import { expect, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

/** Signs a new account up from the sign-up page, landing on the home page. */
async function signUp(player, account) {
  await player.page.goto("/signup");
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page).toHaveURL("/");
}

/** Logs in from the login page, landing on the home page. */
async function logIn(player, email, password) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill(password);
  await player.page.getByRole("button", { name: "Log in" }).click();
  await expect(player.page).toHaveURL("/");
}

// Someone with an account: signing up, out and in, and what the account pages do once signed in.
test.describe("account holder", () => {
  test("signs up, logs out, logs back in — always landing where they meant to go", async ({ players }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.email, account.password] });
    const { page } = riya;

    await page.goto("/games/chess");
    await page.getByRole("banner").getByRole("link", { name: "Sign up" }).click();
    await expect(page).toHaveURL("/signup?next=%2Fgames%2Fchess");
    await expect(page).toHaveTitle("Sign up · ClassiCade");
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL("/games/chess");
    const banner = page.getByRole("banner");
    await expect(banner).toContainText(account.username);
    await expect(banner.getByRole("link", { name: "Log in" })).toHaveCount(0);

    // Signed in, the account pages have nothing to offer: they pass straight through.
    await page.goto("/login?next=%2Fprofile");
    await expect(page).toHaveURL("/profile");
    await expect(page.getByRole("heading", { name: account.username })).toBeVisible();
    await page.goto("/signup");
    await expect(page).toHaveURL("/");

    await banner.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/");
    await expect(banner.getByRole("link", { name: "Log in" })).toBeVisible();

    await page.goto("/profile");
    await page.getByRole("link", { name: "log in", exact: true }).click();
    await page.getByLabel("Email").fill(account.email.toUpperCase());
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/profile");
    await expect(page.getByRole("heading", { name: account.username })).toBeVisible();
  });

  test("a wrong password gets one generic answer and keeps the form", async ({ players }) => {
    const account = newAccount();
    const riya = await players.open("riya", { secrets: [account.password, "not my password"] });
    riya.expect(401, "/api/auth/login");
    const { page } = riya;

    for (const email of [account.email, "nobody.here@example.com"]) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("not my password");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
      await expect(page).toHaveURL("/login");
    }
  });

  test("changes the password on the profile: this browser stays signed in, the other one is signed out", async ({
    players,
  }) => {
    const account = newAccount();
    const newPassword = `${account.password} renewed`;
    const secrets = { secrets: [account.email, account.password, newPassword, "not my password"] };
    const laptop = await players.open("laptop", secrets);
    await signUp(laptop, account);
    const phone = await players.open("phone", secrets);
    await logIn(phone, account.email, account.password);
    laptop.expect(400, "/api/auth/password");

    await laptop.page.goto("/profile");
    const settings = laptop.page.getByRole("region", { name: "Account" });
    await settings.getByLabel("Current password").fill("not my password");
    await settings.getByLabel("New password").fill(newPassword);
    await settings.getByRole("button", { name: "Change password" }).click();
    await expect(settings.getByText("That is not your current password")).toBeVisible();
    await settings.getByLabel("Current password").fill(account.password);
    await settings.getByRole("button", { name: "Change password" }).click();
    await expect(settings.getByRole("status")).toHaveText(
      "Password changed. Your other devices are signed out.",
    );
    await expect(settings.getByLabel("New password")).toHaveValue("");

    await laptop.page.reload();
    await expect(laptop.page.getByRole("heading", { name: account.username })).toBeVisible();
    await phone.page.reload();
    await expect(phone.page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeVisible();

    phone.expect(401, "/api/auth/login");
    await phone.page.goto("/login");
    await phone.page.getByLabel("Email").fill(account.email);
    await phone.page.getByLabel("Password").fill(account.password);
    await phone.page.getByRole("button", { name: "Log in" }).click();
    await expect(phone.page.getByRole("alert")).toHaveText("Invalid email or password");
    await phone.page.getByLabel("Password").fill(newPassword);
    await phone.page.getByRole("button", { name: "Log in" }).click();
    await expect(phone.page).toHaveURL("/");
    await expect(phone.page.getByRole("banner")).toContainText(account.username);
  });

  test("signs out the other devices from one browser, which stays signed in", async ({ players }) => {
    const account = newAccount();
    const secrets = { secrets: [account.email, account.password] };
    const laptop = await players.open("laptop", secrets);
    await signUp(laptop, account);
    const phone = await players.open("phone", secrets);
    await logIn(phone, account.email, account.password);
    await expect(phone.page.getByRole("banner")).toContainText(account.username);

    await laptop.page.goto("/profile");
    const settings = laptop.page.getByRole("region", { name: "Account" });
    await settings.getByRole("button", { name: "Sign out other devices" }).click();
    await expect(settings.getByRole("status")).toHaveText("Your other devices are signed out.");

    await phone.page.goto("/profile");
    await expect(phone.page.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await expect(phone.page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeVisible();
    await laptop.page.reload();
    await expect(laptop.page.getByRole("heading", { name: account.username })).toBeVisible();
    await expect(laptop.page.getByRole("banner")).toContainText(account.username);
  });

  test("a taken email or username is explained on the right field", async ({ players }) => {
    const account = newAccount();
    const first = await players.open("first", { secrets: [account.password] });
    await first.page.goto("/signup");
    await first.page.getByLabel("Username").fill(account.username);
    await first.page.getByLabel("Email").fill(account.email);
    await first.page.getByLabel("Password").fill(account.password);
    await first.page.getByRole("button", { name: "Create account" }).click();
    await expect(first.page).toHaveURL("/");

    const second = await players.open("second", { secrets: [account.password] });
    second.expect(409, "/api/auth/signup");
    await second.page.goto("/signup");
    await second.page.getByLabel("Username").fill(account.username.toUpperCase());
    await second.page.getByLabel("Email").fill(`other.${account.email}`);
    await second.page.getByLabel("Password").fill(account.password);
    await second.page.getByRole("button", { name: "Create account" }).click();

    await expect(second.page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
    await expect(second.page.getByText("That username is taken")).toBeVisible();
  });
});
