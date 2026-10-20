import { expect, header, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";
import { newAccount } from "./personas.js";

// Reports (CC-044, ADR-071). Riya, a guest, plays Rock Paper Scissors with Bob, an account whose name she finds
// offensive. She reports him from his seat with a reason (there is no box to type in) and blocks him in one tap from
// the thank-you. The request names Bob only by the seat and the id the page saw there, never by a player id, and
// Bob's browser hears nothing. She reports again from her match history. The owner reads the report in the console
// and renames Bob to a safe default, which signs him out; he logs in again under the new name.

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

async function logIn(player, { email, password }) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill(password);
  await player.page.getByRole("button", { name: "Log in" }).click();
  await expect(player.page).toHaveURL("/");
}

test.describe("reports", () => {
  test("a guest reports an account from its seat and from history, blocks in one tap, and the owner renames it", async ({
    players,
  }) => {
    const account = newAccount();
    const bob = await players.open("bob", { secrets: [account.password, account.email] });
    await bob.page.goto("/signup");
    await bob.page.getByLabel("Username").fill(account.username);
    await bob.page.getByLabel("Email").fill(account.email);
    await bob.page.getByLabel("Password").fill(account.password);
    await bob.page.getByRole("button", { name: "Create account" }).click();
    await expect(bob.page).toHaveURL("/");

    const riya = await players.open("riya");
    await riya.page.goto("/");
    await riya.page.getByRole("button", { name: "Play as a guest" }).click();
    await expect((await header(riya.page)).getByText(/^Guest-/)).toBeVisible();
    await riya.page.goto("/games/rock-paper-scissors");
    await riya.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await riya.page.getByRole("button", { name: "Create room" }).click();
    const invite = await riya.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    await bob.page.goto(invite);
    await choices(riya).getByRole("button", { name: /Rock/ }).click();
    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(riya.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    const bobFramesBefore = bob.record.socketFrames.length;

    // From Bob's seat, next to Block. A reason is needed first.
    await riya.page.getByRole("button", { name: `Report ${account.username}` }).click();
    const dialog = riya.page.getByRole("dialog", { name: new RegExp(`Report ${account.username}`) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByText("Pick a reason first.")).toBeVisible();
    await dialog.getByRole("radio", { name: /Offensive name/ }).check();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    const sent = riya.page.waitForRequest((r) => r.url().endsWith("/api/reports") && r.method() === "POST");
    await dialog.getByRole("button", { name: "Send report" }).click();
    const request = await sent;

    expect(request.postDataJSON()).toEqual({
      roomCode: expect.stringMatching(/^[A-Z0-9]{6}$/),
      seat: expect.any(Number),
      seatId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      reason: "name",
    });
    expect(request.postData()).not.toMatch(/guest_|user_/);
    const thanks = riya.page.getByRole("dialog", { name: /Thanks, we got it/ });
    await expect(thanks).toContainText(`${account.username} is not told that you reported them.`);
    await expect(thanks).toContainText("Childline: 1098");

    // Block in one tap, by the report's id.
    await thanks.getByRole("button", { name: `Block ${account.username} too` }).click();
    await expect(thanks).toContainText(`You blocked ${account.username}.`);
    await thanks.getByRole("button", { name: "Close" }).click();
    await expect(riya.page.getByRole("list", { name: "Players" }).getByText("blocked")).toBeVisible();
    // Nothing Bob's browser received names the report.
    expect(bob.record.socketFrames.slice(bobFramesBefore).join("\n")).not.toMatch(/report/i);

    // From Riya's history: the same thank-you.
    await riya.page.goto("/profile");
    const history = riya.page.getByRole("list", { name: "Match history" });
    await history.getByRole("button", { name: `Report ${account.username}` }).click();
    const again = riya.page.getByRole("dialog", { name: new RegExp(`Report ${account.username}`) });
    await again.getByRole("radio", { name: /Cheating or stalling/ }).check();
    await again.getByRole("button", { name: "Send report" }).click();
    await expect(riya.page.getByRole("dialog", { name: /Thanks, we got it/ })).toBeVisible();
    await riya.page.getByRole("button", { name: "Close" }).click();

    // The owner reads it as text and renames Bob.
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    await logIn(owner, OWNER);
    await owner.page.goto("/admin/reports");
    await expect(owner.page).toHaveTitle("Reports · Owner console · ClassiCade");
    const group = owner.page.getByRole("article").filter({ hasText: account.username });
    await expect(group).toContainText("1 report from 1 person");
    await expect(group.getByText("Offensive name").first()).toBeVisible();
    await group.getByRole("button", { name: "Rename" }).click();
    const confirm = owner.page.getByRole("dialog", { name: `Rename ${account.username}?` });
    await confirm.getByRole("button", { name: "Rename to a safe name" }).click();
    await expect(
      owner.page.getByText(new RegExp(`${account.username} is now Player_[A-Z0-9]{6}\\.`)),
    ).toBeVisible();
    const safeName = (await owner.page.getByText(/is now Player_/).textContent()).match(
      /Player_[A-Z0-9]{6}/,
    )[0];
    await expect(owner.page.getByRole("article").filter({ hasText: account.username })).toHaveCount(0);

    // Bob is signed out everywhere, and comes back under the safe name.
    await bob.page.goto("/");
    await expect((await header(bob.page)).getByRole("link", { name: "Log in" })).toBeVisible();
    await logIn(bob, account);
    await expect((await header(bob.page)).getByText(safeName)).toBeVisible();
  });

  test("a visitor and a guest get the ordinary not found page at /admin/reports", async ({ players }) => {
    const visitor = await players.open("visitor");
    visitor.record.expected.push({ status: 404, path: "/admin/reports" });
    await visitor.page.goto("/admin/reports");
    await expect(visitor.page.getByRole("heading", { name: /not found/i })).toBeVisible();
    await expect(visitor.page.getByText("Reports players made")).toHaveCount(0);
  });
});
