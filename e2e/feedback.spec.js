import { createRoom, expect, formFactor, header, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";
import { newAccount } from "./personas.js";

// In-app feedback (CC-290, ADR-059). A guest in a room sends a bug from the footer on a laptop and from the header
// menu on a phone. What reaches the server names the room only by its pattern and says nothing about who sent it.
// The owner reads it in the console as plain text and marks it done, and nobody else can tell that the inbox exists.

/** Opens the Feedback dialog the way this device finds it: the header menu on a phone, the footer on a laptop. */
async function openFeedback(page, testInfo) {
  if (formFactor(testInfo) === "mobile") {
    await (await header(page)).getByRole("button", { name: "Feedback" }).click();
  } else {
    await page.getByRole("contentinfo").getByRole("button", { name: "Feedback" }).click();
  }
  const dialog = page.getByRole("dialog", { name: /Send us feedback/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function logIn(player, { email, password }) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill(password);
  await player.page.getByRole("button", { name: "Log in" }).click();
  await expect(player.page).toHaveURL("/");
}

test.describe("feedback", () => {
  test("a guest in a room sends a bug, and the request carries the room's pattern, never its code or the player", async ({
    players,
  }, testInfo) => {
    const riya = await players.open("riya");
    const { page } = riya;
    await page.goto("/");
    await page.getByRole("button", { name: "Play as a guest" }).click();
    const name = await (await header(page)).getByText(/^Guest-/).textContent();
    const { path, code } = await createRoom(riya, "rock-paper-scissors");
    await expect(page).toHaveURL(path);

    const dialog = await openFeedback(page, testInfo);
    await expect(dialog.getByRole("radio", { name: "Bug" })).toBeChecked();
    await expect(dialog.getByRole("textbox", { name: /Email me back/ })).toHaveCount(0);

    // An empty message is never sent.
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByText("Write a message first.")).toBeVisible();

    const message = dialog.getByRole("textbox", { name: "Message" });
    await message.fill("The invite link did not copy on my phone");
    await expect(dialog.getByText("40 / 1000")).toBeVisible();
    const sent = page.waitForRequest((request) => request.url().endsWith("/api/feedback") && request.method() === "POST");
    await dialog.getByRole("button", { name: "Send" }).click();
    const request = await sent;

    await expect(page.getByRole("dialog", { name: /Thank you!/ })).toBeVisible();
    const body = request.postDataJSON();
    expect(body).toEqual({
      type: "bug",
      message: "The invite link did not copy on my phone",
      page: "/games/rock-paper-scissors/rooms/:code",
      build: expect.stringMatching(/^0\.1\.0\+[0-9a-z]+$/),
      device: formFactor(testInfo) === "mobile" ? "phone" : "desktop",
    });
    const raw = request.postData();
    for (const secret of [code, name, "guest_"]) expect(raw).not.toContain(secret);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(path);
  });

  test("an adult account can leave an email for a reply, and the owner reads every item as plain text and marks it done", async ({
    players,
  }, testInfo) => {
    const account = newAccount();
    const adult = await players.open("adult", { secrets: [account.password, account.email] });
    await adult.page.goto("/signup");
    await adult.page.getByLabel("Username").fill(account.username);
    await adult.page.getByLabel("Email").fill(account.email);
    await adult.page.getByLabel("Password").fill(account.password);
    // An adult, the only kind of player who may leave an email for a reply (ADR-059).
    await adult.page.getByLabel("Year of birth").selectOption("1990");
    await adult.page.getByRole("button", { name: "Create account" }).click();
    await expect(adult.page).toHaveURL("/");

    const markup = `<img src=x onerror="document.title='owned'"> ${account.username.slice(-6)}`;
    const dialog = await openFeedback(adult.page, testInfo);
    await dialog.getByRole("radio", { name: "Idea" }).check();
    await dialog.getByRole("textbox", { name: "Message" }).fill(markup);
    await dialog.getByRole("textbox", { name: "Email me back (optional)" }).fill("reply.test@example.com");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(adult.page.getByRole("dialog", { name: /Thank you!/ })).toBeVisible();

    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    await logIn(owner, OWNER);
    await owner.page.goto("/admin/feedback?type=idea");
    await expect(owner.page).toHaveTitle("Feedback · Owner console · ClassiCade");
    const entry = owner.page.getByRole("article").filter({ hasText: account.username.slice(-6) });
    await expect(entry.getByText(markup, { exact: true })).toBeVisible();
    await expect(entry).toContainText("Reply to reply.test@example.com");
    await expect(entry).toContainText("account");
    expect(await entry.locator("img").count()).toBe(0);
    await expect(owner.page).toHaveTitle("Feedback · Owner console · ClassiCade");

    await entry.getByRole("button", { name: "Mark done" }).click();
    await expect(entry.getByText("Done", { exact: true })).toBeVisible();
    await owner.page.getByRole("combobox", { name: "Status" }).selectOption("done");
    await expect(owner.page).toHaveURL("/admin/feedback?type=idea&status=done");
    await expect(owner.page.getByRole("article").filter({ hasText: account.username.slice(-6) })).toBeVisible();
    await owner.page.goBack();
    await expect(owner.page).toHaveURL("/admin/feedback?type=idea");
  });

  test("the inbox is the ordinary not found page and a 404 for a player who is not an admin", async ({ players }) => {
    const riya = await players.open("riya");
    const { page } = riya;
    await page.goto("/");
    await page.getByRole("button", { name: "Play as a guest" }).click();
    await expect((await header(page)).getByText(/^Guest-/)).toBeVisible();
    riya.expect(404, "/api/admin/feedback");
    riya.expect(404, "/admin/feedback");

    await page.goto("/admin/feedback");

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    const api = await page.request.get("/api/admin/feedback");
    expect(api.status()).toBe(404);
    expect(await api.text()).not.toContain("items");
  });
});
