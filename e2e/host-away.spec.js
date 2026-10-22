import { createRoom, expect, header, joinAsGuest, test } from "./fixtures.js";

// BUG-17: a game started after the host had left the waiting room (CC-112). A game now starts only with everyone
// there, and leaving the room page leaves a waiting room.
test.describe("a host who is not there any more", () => {
  test("the host goes to another page: the waiting room closes, and the invite says so", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");

    await (await header(host.page)).getByRole("link", { name: "Games" }).click();
    await expect(host.page).toHaveURL("/");

    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);
    await expect(friend.page.getByRole("heading", { name: "Room closed" })).toBeVisible();
    await expect(friend.page.getByText("Everyone left, so the room closed.")).toBeVisible();
    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toHaveCount(0);
  });

  test("the host closes the tab: the friend waits, and the game starts when the host is back", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    await host.page.close();

    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);
    await expect(friend.page.getByRole("heading", { name: /^Waiting for Guest-/ })).toBeVisible();
    await expect(friend.page.getByText(/is away\. The game starts as soon as they are back\./)).toBeVisible();
    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toHaveCount(0);

    const back = await host.context.newPage();
    await back.goto(room.path);
    await expect(back.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
    await expect(friend.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();
  });

  test("a third player cannot take a seat while the full room waits for its host", async ({ players }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    await host.page.close();
    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);
    await expect(friend.page.getByRole("heading", { name: /^Waiting for Guest-/ })).toBeVisible();

    const stranger = await players.open("stranger");
    await joinAsGuest(stranger, room.path);

    await expect(stranger.page.getByRole("heading", { name: "Can't join this room" })).toBeVisible();
    await expect(stranger.page.getByText("This room is full")).toBeVisible();
  });
});
