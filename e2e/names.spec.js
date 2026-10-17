import { expect, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// A visitor choosing the name everyone else will see. Reserved and rude names get a kind answer that never says
// which word was the problem, and a fair name that only looks close to a listed word goes through (CC-119).
test.describe("visitor choosing a public name", () => {
  test("is told kindly when a name is reserved or unsuitable, then signs up with a fair one", async ({
    players,
  }) => {
    const account = newAccount();
    const visitor = await players.open("visitor", { secrets: [account.email, account.password] });
    visitor.expect(400, "/api/auth/signup");
    const { page } = visitor;
    const username = page.getByLabel("Username");

    await page.goto("/signup");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);

    for (const [name, message] of [
      ["Admin_1", "That name is reserved. Please choose another name."],
      ["ChessBot", "That name is reserved. Please choose another name."],
      ["5h1t_happens", "Please choose another name. Names are shown to everyone, so keep it friendly."],
    ]) {
      await username.fill(name);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByText(message, { exact: true }), name).toBeVisible();
      await expect(username).toHaveAccessibleDescription(`Shown to other players ${message}`);
      await expect(username).toHaveAttribute("aria-invalid", "true");
      await expect(page).toHaveURL("/signup");
    }
    await expect(page.getByText(/admin|bot|shit/i)).toHaveCount(0);

    const fairName = `Dickens_${account.username.slice(-10)}`;
    await username.fill(fairName);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("banner")).toContainText(fairName);
  });
});
