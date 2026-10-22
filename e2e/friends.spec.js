import { expect, header, test } from "./fixtures.js";
import { newAccount } from "./personas.js";
import { realtimeConnects } from "./realtime.js";

// Friends (CC-052, ADR-066). Riya and Arjun, adults, play a game and become friends from the result screen: Arjun
// hears about the request on another page and accepts it, and each sees the other online, then offline once Arjun
// appears offline. A guest is told to save their progress instead. Kabir, a minor, sends his friend link, which
// shows his name to nobody, works once, and needs him to accept. No friends answer or push ever names a player id.

const PLAYER_ID = /(?<![A-Za-z0-9_-])(?:guest|user|deleted|bot)_[A-Za-z0-9-]+/;
const MINOR_YEAR = String(new Date().getFullYear() - 15);

async function signUp(player, birthYear) {
  const account = newAccount();
  await player.page.goto("/signup");
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByLabel("Year of birth").selectOption(birthYear);
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page).toHaveURL("/");
  return account.username;
}

async function asGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  const name = (await header(player.page)).getByText(/^Guest-/);
  await expect(name).toBeVisible();
  return name.textContent();
}

/** The host opens a best-of-1 Rock Paper Scissors room, the other joins by its link, and the host wins. */
async function playOneGame(host, other) {
  await host.page.goto("/games/rock-paper-scissors");
  await host.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await host.page.getByRole("button", { name: "Create room" }).click();
  const invite = await host.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await other.page.goto(invite);
  await host.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Rock/ }).click();
  await other.page
    .getByRole("group", { name: "Your choice" })
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(host.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await expect(other.page.getByRole("heading", { name: "You lost" })).toBeVisible();
}

const friendsList = (page) => page.getByRole("list", { name: "Friends" });
const friendsFrames = (player) => player.record.socketFrames.filter((frame) => frame.includes('"friends:'));
// A push that asks for an answer carries its number after "42".
const requestPushes = (player) =>
  player.record.socketFrames.filter((frame) => /^42\d*\["friends:request"/.test(frame));
const viewPushes = (player) =>
  player.record.socketFrames.filter((frame) => frame.startsWith('42["friends:updated"'));
const connects = (player) => realtimeConnects(player.record.socketFrames);

test.describe("friends", () => {
  test("two adults become friends from the result screen and see each other's presence", async ({
    players,
  }) => {
    const riya = await players.open("riya");
    const arjun = await players.open("arjun");
    const riyaName = await signUp(riya, "1990");
    const arjunName = await signUp(arjun, "1990");
    await playOneGame(riya, arjun);
    const arjunConnects = connects(arjun);
    await arjun.page.goto("/leaderboards");
    // A push only reaches a page that is connected, and a new page connects a little after it loads. Arjun is on
    // the page once his browser is connected again: before that, Riya's request would reach nobody, on any build.
    await expect.poll(() => connects(arjun)).toBeGreaterThan(arjunConnects);

    // Riya adds Arjun from his seat on the result screen. Arjun hears about it on the page he is on.
    await riya.page.getByRole("button", { name: `Add friend ${arjunName}` }).click();
    await expect(riya.page.getByRole("list", { name: "Players" }).getByText("request sent")).toBeVisible();
    await expect(arjun.page.getByText(`${riyaName} wants to be your friend`)).toBeVisible();
    await arjun.page.getByRole("link", { name: "See request" }).click();
    await expect(arjun.page).toHaveURL("/friends");
    const requests = arjun.page.getByRole("list", { name: "Friend requests" });
    await expect(requests.getByText("You played together")).toBeVisible();
    await requests.getByRole("button", { name: `Accept ${riyaName}` }).click();

    // Each sees the other, online, with a profile link because both are adults.
    await expect(friendsList(arjun.page).getByRole("link", { name: riyaName })).toBeVisible();
    await riya.page.goto("/friends");
    const arjunRow = friendsList(riya.page).getByRole("listitem").filter({ hasText: arjunName });
    await expect(arjunRow.getByText("Online")).toBeVisible();

    // Arjun appears offline, and Riya's list says so at once, without a reload.
    await arjun.page.getByRole("button", { name: "Appear offline: off" }).click();
    await expect(arjun.page.getByRole("button", { name: "Appear offline: on" })).toBeVisible();
    await expect(arjunRow.getByText("Offline")).toBeVisible();

    // Nothing either browser received about friends names a player by id.
    for (const player of [riya, arjun]) {
      expect(friendsFrames(player).length).toBeGreaterThan(0);
      expect(friendsFrames(player).join("\n")).not.toMatch(PLAYER_ID);
    }
  });

  test("a friend request sent while the other's page has no connection yet still shows its toast, once", async ({
    players,
  }) => {
    const riya = await players.open("riya");
    const arjun = await players.open("arjun");
    const riyaName = await signUp(riya, "1990");
    const arjunName = await signUp(arjun, "1990");
    await playOneGame(riya, arjun);
    // Arjun's next page cannot reach the realtime server until the request has rung (CC-341).
    let release;
    const released = new Promise((resolve) => {
      release = resolve;
    });
    let held;
    const holding = new Promise((resolve) => {
      held = resolve;
    });
    await arjun.page.routeWebSocket(/\/socket\.io\//, async (socket) => {
      held();
      await released;
      socket.connectToServer();
    });
    await arjun.page.goto("/leaderboards");
    await holding;

    await riya.page.getByRole("button", { name: `Add friend ${arjunName}` }).click();
    await expect(riya.page.getByRole("list", { name: "Players" }).getByText("request sent")).toBeVisible();
    release();

    const toast = arjun.page.getByText(`${riyaName} wants to be your friend`);
    await expect(toast).toBeVisible();
    await arjun.page.getByRole("button", { name: "Close" }).click();
    await expect(toast).toBeHidden();

    // A new page of the same browser shows no second toast: the request waits on the friends page instead.
    const pushesBefore = requestPushes(arjun).length;
    const connectsBefore = connects(arjun);
    await arjun.page.goto("/friends");
    await expect.poll(() => connects(arjun)).toBeGreaterThan(connectsBefore);
    await expect(arjun.page.getByRole("list", { name: "Friend requests" }).getByText(riyaName)).toBeVisible();
    // A settle point: appearing offline pushes Arjun's friends view to this socket, after whatever the server sent
    // it as it connected.
    const viewsBefore = viewPushes(arjun).length;
    await arjun.page.getByRole("button", { name: "Appear offline: off" }).click();
    await expect.poll(() => viewPushes(arjun).length).toBeGreaterThan(viewsBefore);
    expect(requestPushes(arjun)).toHaveLength(pushesBefore);
    await expect(toast).toHaveCount(0);
  });

  test("a guest is offered no Add friend, and the friends page tells them to save their progress", async ({
    players,
  }) => {
    const riya = await players.open("riya");
    const guest = await players.open("guest");
    const riyaName = await signUp(riya, "1990");
    await asGuest(guest);
    await playOneGame(riya, guest);

    // A guest is offered no Add friend on the result screen, and the Friends page says why.
    await expect(guest.page.getByRole("button", { name: `Block ${riyaName}` })).toBeVisible();
    await expect(guest.page.getByRole("button", { name: /^Add friend / })).toHaveCount(0);

    await guest.page.goto("/friends");
    await expect(guest.page.getByText("Friends banane ke liye apni progress save karo.")).toBeVisible();
    await expect(guest.page.getByRole("main").getByRole("link", { name: "Save progress" })).toHaveAttribute(
      "href",
      "/signup?next=%2Ffriends",
    );
  });

  test("a minor's friend link hides his name, works once, and waits for him to accept", async ({
    players,
  }) => {
    const kabir = await players.open("kabir");
    const arjun = await players.open("arjun");
    const meera = await players.open("meera");
    await signUp(kabir, MINOR_YEAR);
    const arjunName = await signUp(arjun, "1990");

    await kabir.page.goto("/friends");
    await kabir.page.getByRole("button", { name: "Make a friend link" }).click();
    const link = await kabir.page.getByRole("textbox", { name: "Friend link" }).inputValue();
    expect(new URL(link).pathname).toMatch(/^\/friends\/add\/[A-Za-z0-9_-]{22}$/);

    await arjun.page.goto(link);
    await expect(
      arjun.page.getByText("A ClassiCade player wants to be friends on ClassiCade."),
    ).toBeVisible();
    await arjun.page.getByRole("button", { name: "Add friend" }).click();
    await expect(
      arjun.page.getByText("Request sent. You'll be friends as soon as they say yes."),
    ).toBeVisible();

    // The link is used up: anyone else who opens it is told so.
    meera.expect(404, `/api${new URL(link).pathname.replace("/friends/add/", "/friends/links/")}`);
    await meera.page.goto(link);
    await expect(meera.page.getByText("Yeh link ab nahi chalta.")).toBeVisible();

    // Kabir sees who opened it, with the safety line, and accepts.
    await kabir.page.goto("/friends");
    const requests = kabir.page.getByRole("list", { name: "Friend requests" });
    await expect(requests.getByText("Opened your friend link")).toBeVisible();
    await expect(kabir.page.getByText("Sirf unhe add karo jinhe tum sach mein jaante ho.")).toBeVisible();
    await requests.getByRole("button", { name: `Accept ${arjunName}` }).click();
    await expect(friendsList(kabir.page).getByText(arjunName)).toBeVisible();
    // A minor's profile is never linked, even to a friend (ADR-065.2).
    await arjun.page.goto("/friends");
    await expect(friendsList(arjun.page).getByRole("listitem")).toHaveCount(1);
    await expect(friendsList(arjun.page).getByRole("link")).toHaveCount(0);
  });
});
