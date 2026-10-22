import { expect, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";
import { newAccount } from "./personas.js";

// Invites to friends (CC-052 part 2), behind the friend_invites flag, which the owner turns on from the console.
// Riya, Arjun and Meera are adults and friends. Riya invites Arjun and Meera to the same game: Arjun hears it on the
// page he is on and accepts, Riya hears that he took it, and Meera reads "Game filled" with Invite again. No answer
// or push either browser received names a player by id.

const PLAYER_ID = /(?<![A-Za-z0-9_-])(?:guest|user|deleted|bot)_[A-Za-z0-9-]+/;

async function signUp(player) {
  const account = newAccount();
  await player.page.goto("/signup");
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByLabel("Year of birth").selectOption("1990");
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page).toHaveURL("/");
  return account.username;
}

/** The owner turns the flag on for everyone it is for. Setting it again changes nothing, so runs may overlap. */
async function turnInvitesOn(players) {
  const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
  await owner.page.goto("/login");
  await owner.page.getByLabel("Email").fill(OWNER.email);
  await owner.page.getByLabel("Password").fill(OWNER.password);
  await owner.page.getByRole("button", { name: "Log in" }).click();
  await expect(owner.page).toHaveURL("/");
  const status = await owner.page.evaluate(async () => {
    const res = await fetch("/api/admin/flags/friend_invites", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rollout: "on" }),
    });
    return res.status;
  });
  expect(status).toBe(200);
}

/** `maker` sends a friend link, `other` opens it and asks, and `maker` accepts on the friends page. */
async function befriend(maker, other, otherName) {
  await maker.page.goto("/friends");
  await maker.page.getByRole("button", { name: "Make a friend link" }).click();
  const link = await maker.page.getByRole("textbox", { name: "Friend link" }).inputValue();
  await other.page.goto(link);
  await other.page.getByRole("button", { name: "Add friend" }).click();
  await expect(
    other.page.getByText("Request sent. You'll be friends as soon as they say yes."),
  ).toBeVisible();
  await maker.page.goto("/friends");
  await maker.page
    .getByRole("list", { name: "Friend requests" })
    .getByRole("button", { name: `Accept ${otherName}` })
    .click();
  await expect(maker.page.getByRole("list", { name: "Friends" }).getByText(otherName)).toBeVisible();
}

/** Riya invites a friend to Rock Paper Scissors from her friends page. */
async function invite(riya, name) {
  await riya.page.goto("/friends");
  await riya.page.getByRole("button", { name: `Invite ${name}` }).click();
  const dialog = riya.page.getByRole("dialog", { name: `Invite ${name}` });
  await dialog.getByRole("button", { name: "Rock Paper Scissors" }).click();
  await expect(riya.page.getByRole("dialog", { name: "Invite sent" })).toBeVisible();
  await riya.page.getByRole("button", { name: "Done" }).click();
}

const challengeFrames = (player) =>
  player.record.socketFrames.filter((frame) => frame.includes('"challenge:') || frame.includes('"friends:'));

test.describe("invites to friends (CC-052)", () => {
  test("the first friend to accept plays, the sender hears it, and the other friend reads Game filled", async ({
    players,
  }) => {
    // Four browsers, three sign-ups and two friendships before the invite: slow on CI's WebKit runners.
    test.slow();
    await turnInvitesOn(players);
    const riya = await players.open("riya");
    const arjun = await players.open("arjun");
    const meera = await players.open("meera");
    const riyaName = await signUp(riya);
    const arjunName = await signUp(arjun);
    const meeraName = await signUp(meera);
    await befriend(riya, arjun, arjunName);
    await befriend(riya, meera, meeraName);
    await arjun.page.goto("/leaderboards");
    await meera.page.goto("/leaderboards");

    await invite(riya, arjunName);
    await invite(riya, meeraName);
    await riya.page.goto("/leaderboards");

    // Arjun hears it on the page he is on, and accepts.
    const popup = arjun.page.getByRole("region", { name: "Challenge" });
    await expect(popup).toContainText(`${riyaName} challenges you to Rock Paper Scissors.`);
    await popup.getByRole("button", { name: "Accept and go" }).click();
    await expect(arjun.page).toHaveURL(/\/games\/rock-paper-scissors\/rooms\/[A-Z0-9]{6}$/);

    // Meera's invite is filled: her popup goes, and she reads Game filled with the way to invite Riya again.
    await expect(
      meera.page.getByText(`Game filled: ${riyaName} is playing someone else now.`).first(),
    ).toBeVisible();
    await expect(meera.page.getByRole("region", { name: "Challenge" })).toHaveCount(0);
    await meera.page.getByRole("link", { name: "Invite again?" }).click();
    await expect(meera.page.getByRole("heading", { name: "Game filled" })).toBeVisible();
    await meera.page.getByRole("button", { name: `Invite ${riyaName} again` }).click();
    await expect(meera.page.getByRole("heading", { name: "Your Rock Paper Scissors invite" })).toBeVisible();

    // Riya hears on her page that Arjun took it, and both play.
    const taken = riya.page.getByRole("region", { name: "Challenge taken" });
    await expect(taken).toContainText(`${arjunName} took your Rock Paper Scissors challenge.`);
    await taken.getByRole("button", { name: "Go and play" }).click();
    await expect(riya.page.getByRole("group", { name: "Your choice" })).toBeVisible();
    await expect(arjun.page.getByRole("group", { name: "Your choice" })).toBeVisible();

    for (const player of [riya, arjun, meera]) {
      expect(challengeFrames(player).length).toBeGreaterThan(0);
      expect(challengeFrames(player).join("\n")).not.toMatch(PLAYER_ID);
    }
  });

  test("an offline friend's invite waits in their inbox, and the sender may send it on WhatsApp", async ({
    players,
  }) => {
    await turnInvitesOn(players);
    const riya = await players.open("riya");
    const arjun = await players.open("arjun");
    await signUp(riya);
    const arjunName = await signUp(arjun);
    await befriend(riya, arjun, arjunName);
    await arjun.leave();

    await riya.page.goto("/friends");
    const row = riya.page
      .getByRole("list", { name: "Friends" })
      .getByRole("listitem")
      .filter({ hasText: arjunName });
    await expect(row.getByText("Offline")).toBeVisible();
    await riya.page.getByRole("button", { name: `Invite ${arjunName}` }).click();
    await riya.page.getByRole("dialog").getByRole("button", { name: "Chess" }).click();
    const sent = riya.page.getByRole("dialog", { name: "Invite sent" });
    await expect(
      sent.getByText(`${arjunName} is offline. Your invite waits in their inbox for 24 hours.`, {
        exact: false,
      }),
    ).toBeVisible();
    const whatsapp = await sent.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
    expect(decodeURIComponent(whatsapp)).toMatch(/\/challenge\/[0-9a-hjkmnp-tv-z]{20}/);

    // A stranger who is not Riya's friend is refused with the same 404 as a handle nobody has.
    riya.expect(404, "/api/challenges");
    const answer = await riya.page.evaluate(async () => {
      const res = await fetch("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: "chess", to: { handle: "zzzzzzzzzzzzzzzz" } }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(answer.status).toBe(404);
    expect(answer.body.error.message).toBe("We couldn't find that player");
  });
});
