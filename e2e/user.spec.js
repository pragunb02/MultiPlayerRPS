import { expect, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

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
