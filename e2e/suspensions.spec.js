import { expect, header, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";
import { newAccount } from "./personas.js";

// Account suspension (CC-334, ADR-078). Bob, an account, plays Riya, a guest, who reports him. The owner suspends
// Bob for 7 days from the report console. Bob's open tab is signed out at once; when he logs in again he is told
// when the suspension ends and how to appeal, and nothing about who reported. The owner reads Bob's history and
// lifts the suspension from the "Suspended now" list, and Bob can log in again.

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

/** The evidence size of each project: 1280×800 on the desktop, 390×844 on the phone (CC-334 brief). */
const EVIDENCE_SIZE = Object.freeze({
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
});

async function logIn(player, { email, password }) {
  await player.page.goto("/login");
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill(password);
  await player.page.getByRole("button", { name: "Log in" }).click();
}

test.describe("suspensions", () => {
  test("the owner suspends a reported account, which is signed out and told when it ends, then lifts it", async ({
    players,
  }, testInfo) => {
    const size = EVIDENCE_SIZE[testInfo.project.name];
    const evidence = async (player, name) => {
      if (size === undefined) return;
      await player.page.setViewportSize(size);
      await player.page.screenshot({ path: testInfo.outputPath(`${name}-${size.width}x${size.height}.png`) });
    };
    const account = newAccount();
    const bob = await players.open("bob", { secrets: [account.password, account.email] });
    await bob.page.goto("/signup");
    await bob.page.getByLabel("Username").fill(account.username);
    await bob.page.getByLabel("Email").fill(account.email);
    await bob.page.getByLabel("Password").fill(account.password);
    await bob.page.getByRole("button", { name: "Create account" }).click();
    await expect(bob.page).toHaveURL("/");

    // Riya, a guest, plays Bob and reports him from his seat.
    const riya = await players.open("riya");
    await riya.page.goto("/");
    await riya.page.getByRole("button", { name: "Play as a guest" }).click();
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
    await riya.page.getByRole("button", { name: `Report ${account.username}` }).click();
    const report = riya.page.getByRole("dialog", { name: new RegExp(`Report ${account.username}`) });
    await report.getByRole("radio", { name: /pareshan|Harassment/ }).check();
    await report.getByRole("button", { name: "Send report" }).click();
    const thanks = riya.page.getByRole("dialog", { name: /Thanks, we got it/ });
    await thanks.getByRole("button", { name: "Close" }).first().click();
    await expect(thanks).toHaveCount(0);
    const riyaFramesBefore = riya.record.socketFrames.length;

    // The owner suspends Bob for 7 days, for harassment, from his group.
    const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
    await logIn(owner, OWNER);
    await expect(owner.page).toHaveURL("/");
    await owner.page.goto("/admin/reports");
    const group = owner.page.getByRole("article").filter({ hasText: account.username });
    await group.getByRole("button", { name: "Suspend" }).click();
    const dialog = owner.page.getByRole("dialog", { name: `Suspend ${account.username}?` });
    await expect(dialog.getByRole("radio")).toHaveCount(4);
    await dialog.getByRole("radio", { name: "7 days" }).check();
    await dialog.getByRole("combobox", { name: "Reason" }).selectOption("harassment");
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await evidence(owner, "suspend-dialog");
    const sent = owner.page.waitForRequest((r) => r.url().endsWith("/suspension") && r.method() === "POST");
    await dialog.getByRole("button", { name: `Suspend ${account.username}` }).click();
    expect((await sent).postDataJSON()).toEqual({ duration: "7d", reason: "harassment" });
    await expect(owner.page.getByText(new RegExp(`${account.username} is suspended until`))).toBeVisible();

    // Bob's open tab is signed out at once, without a reload.
    await expect((await header(bob.page)).getByRole("link", { name: "Log in" })).toBeVisible();

    // At sign-in he is told when it ends and how to appeal, and nothing about who reported.
    bob.expect(403, "/api/auth/login");
    await logIn(bob, account);
    const paused = bob.page.getByRole("region", { name: "Your account is paused" });
    await expect(paused).toContainText(/paused until \d{1,2} [A-Z][a-z]{2} \d{4}/);
    await expect(paused).toContainText("If you think this is a mistake, tell us through the feedback form.");
    await expect(paused).not.toContainText(/report|harass|Guest-/i);
    await evidence(bob, "suspended-sign-in");
    await paused.getByRole("button", { name: "Tell us through the feedback form" }).click();
    await expect(bob.page.getByRole("dialog", { name: /Send us feedback/ })).toBeVisible();
    await bob.page.keyboard.press("Escape");

    // Riya, who reported, is told nothing.
    expect(riya.record.socketFrames.slice(riyaFramesBefore).join("\n")).not.toMatch(/suspen/i);

    // The owner reads Bob's history on the acted-on group, then lifts the suspension.
    await owner.page.goto("/admin/reports?status=actioned");
    const closed = owner.page.getByRole("article").filter({ hasText: account.username });
    await closed.getByRole("button", { name: "History" }).click();
    const history = owner.page.getByRole("list", { name: `Suspensions of ${account.username}` });
    await expect(history.getByRole("listitem")).toHaveCount(1);
    await expect(history).toContainText("7 days · Harassing other players");
    await expect(history).toContainText(`by ${OWNER.username}`);
    await history.scrollIntoViewIfNeeded();
    await evidence(owner, "suspension-history");
    const now = owner.page.getByRole("list", { name: "Suspended now" });
    await now.getByRole("button", { name: `Lift ${account.username}'s suspension` }).click();
    await owner.page.getByRole("button", { name: "Lift the suspension" }).click();
    await expect(owner.page.getByText(`${account.username}'s suspension is lifted.`)).toBeVisible();

    // Lifted: Bob logs in again.
    await logIn(bob, account);
    await expect(bob.page).toHaveURL("/");
    await expect((await header(bob.page)).getByText(account.username)).toBeVisible();
  });
});
