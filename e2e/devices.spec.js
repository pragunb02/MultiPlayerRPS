import { expect, header, test } from "./fixtures.js";
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
async function logIn(player, account) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByRole("button", { name: "Log in" }).click();
  await expect(player.page).toHaveURL("/");
}

// An account holder signed in on two browsers signs one of them out from the list on the profile (CC-262).
test.describe("account holder's signed-in devices", () => {
  test("lists both browsers and signs the other one out, which stays signed out", async ({ players }) => {
    const account = newAccount();
    const secrets = { secrets: [account.email, account.password] };
    const laptop = await players.open("laptop", secrets);
    await signUp(laptop, account);
    const phone = await players.open("phone", secrets);
    await logIn(phone, account);
    await expect(phone.page.getByRole("banner")).toContainText(account.username);

    await laptop.page.goto("/profile");
    const settings = laptop.page.getByRole("region", { name: "Account" });
    const list = settings.getByRole("list", { name: "Signed-in devices" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("listitem").first()).toContainText("This device");
    await expect(list.getByRole("button", { name: /^Sign out / })).toHaveCount(1);

    await list.getByRole("button", { name: /^Sign out / }).click();

    const status = settings.getByRole("status");
    await expect(status).toHaveText(/ is signed out\.$/);
    await expect(status).toBeFocused();
    await expect(list.getByRole("listitem")).toHaveCount(1);

    await phone.page.goto("/profile");
    await expect(phone.page.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await expect((await header(phone.page)).getByRole("link", { name: "Log in" })).toBeVisible();
    await laptop.page.reload();
    await expect(laptop.page.getByRole("heading", { name: account.username })).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(1);
  });
});
