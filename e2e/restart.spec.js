import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";
import { restartServer } from "./serverControl.js";

// The server restarts under the players' feet (CC-101): every deploy does it, so does a crash, and the hosting
// plan puts an idle server to sleep. Rooms are kept in the database, so the players come back to the same room
// and the same game on their own, without a reload. These tests restart the real server process, so they run
// after all the others and one at a time (playwright.config.js).

// Each restart waits for a new server process to boot, and one test also waits for a rematch window to end.
test.describe.configure({ timeout: 90_000 });

const RPS = "/games/rock-paper-scissors";
const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
const seats = (player) => player.page.getByRole("list", { name: "Players" });
const board = (player) => player.page.getByRole("grid", { name: "Tic-Tac-Toe board" });
const cell = (player, name) => board(player).getByRole("gridcell", { name: new RegExp(`^${name}:`) });

/** A guest from the home page's button. Answers their name. */
async function asGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  const name = player.page.getByRole("banner").getByText(/^Guest-/);
  await expect(name).toBeVisible();
  return name.textContent();
}

/** Alice hosts Rock Paper Scissors over `bestOf` rounds, Bob joins by the invite link. */
async function startRps(players, bestOf) {
  const alice = await players.open("alice");
  const aliceName = await asGuest(alice);
  await alice.page.goto(RPS);
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption(String(bestOf));
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const bob = await players.open("bob");
  const bobName = await asGuest(bob);
  await bob.page.goto(invite);
  await expect(choices(alice)).toBeVisible();
  await expect(choices(bob)).toBeVisible();
  return { alice, bob, aliceName, bobName, roomPath: new URL(invite).pathname };
}

/**
 * Restarts the server while these players are in the middle of something, and waits until each of them is back
 * in the room: everyone is shown as connected again, which needs every browser to have rejoined by itself.
 */
async function restartDuring(roomPlayers, options) {
  const before = roomPlayers.map(connects);
  roomPlayers.forEach((player) => player.expectRestart());
  await restartServer(options);
  for (const [index, player] of roomPlayers.entries()) {
    await expect.poll(() => connects(player), { timeout: 20_000 }).toBeGreaterThan(before[index]);
    await expect(seats(player)).toHaveCount(1);
    await expect(seats(player)).not.toContainText("disconnected", { timeout: 20_000 });
  }
}

/** How often the server has accepted this browser's realtime connection (Socket.IO's "connected" packet). */
const connects = (player) => player.record.socketFrames.filter((frame) => frame.startsWith("40{")).length;

/** The two Tic-Tac-Toe players in turn order: X moves first. */
async function inTurnOrder(host, friend) {
  const mark = host.page.getByText(/^You play [XO]$/);
  await expect(mark).toBeVisible();
  return (await mark.textContent()) === "You play X" ? [host, friend] : [friend, host];
}

test.describe("the server restarts", () => {
  test("in the middle of Rock Paper Scissors: the game goes on, and a hidden choice stays hidden", async ({
    players,
  }) => {
    const { alice, bob, roomPath } = await startRps(players, 3);
    await choices(alice).getByRole("button", { name: /Rock/ }).click();
    await expect(bob.page.getByText(/has chosen/)).toBeVisible();

    await restartDuring([alice, bob]);

    // Bob still only knows that Alice chose, and the server never told his browser what.
    await expect(bob.page.getByText(/has chosen/)).toBeVisible();
    expect(bob.record.socketFrames.join("\n")).not.toMatch(/"rock"/);
    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    for (const player of [alice, bob]) {
      await expect(player.page.getByRole("list", { name: "Rounds" }).getByRole("listitem")).toHaveCount(1);
      expect(player.url()).toBe(roomPath);
    }
  });

  test("when it crashes during Tic-Tac-Toe: the board is kept, a reload shows it, and the game is played out", async ({
    players,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "tic-tac-toe");
    const friend = await players.open("friend");
    await joinAsGuest(friend, room.path);
    const [x, o] = await inTurnOrder(host, friend);
    await cell(x, "top left").click();
    await expect(cell(o, "top left")).toHaveAccessibleName("top left: X");
    await cell(o, "middle centre").click();
    await expect(cell(x, "middle centre")).toHaveAccessibleName("middle centre: O");

    await restartDuring([host, friend], { crash: true });
    await o.page.reload();

    await expect(cell(o, "top left")).toHaveAccessibleName("top left: X");
    await expect(cell(o, "middle centre")).toHaveAccessibleName("middle centre: O");
    await expect(seats(x)).not.toContainText("disconnected");
    await cell(x, "top centre").click();
    await cell(o, "bottom left").click();
    await cell(x, "top right").click();
    await expect(x.page.getByRole("heading", { name: "You won!" })).toBeVisible();
    await expect(o.page.getByRole("heading", { name: "You lost" })).toBeVisible();
  });

  test("while a rematch is asked for: the request survives, and accepting it starts the next game", async ({
    players,
  }) => {
    const { alice, bob, aliceName, roomPath } = await startRps(players, 1);
    await choices(alice).getByRole("button", { name: /Rock/ }).click();
    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await alice.page.getByRole("button", { name: "Rematch" }).click();
    await expect(bob.page.getByText(`${aliceName} wants a rematch!`)).toBeVisible();

    await restartDuring([alice, bob]);
    // A reload asks the new server process, so what Bob sees now is what it kept.
    await bob.page.reload();

    await expect(bob.page.getByText(`${aliceName} wants a rematch!`)).toBeVisible();
    await bob.page.getByRole("button", { name: "Accept rematch" }).click();
    for (const player of [alice, bob]) {
      await expect(choices(player)).toBeVisible();
      expect(player.url()).toBe(roomPath);
    }
  });
});

test.describe("a long wait on the result screen", () => {
  test("the rematch window counts down, then the room closes and every way back says why", async ({
    players,
  }) => {
    // A short rematch window, for this server process only. Production always has the standard half hour.
    await restartServer({ rooms: { lifetimes: { rematchWindowMs: 8_000 }, sweepIntervalMs: 500 } });
    const { alice, bob } = await startRps(players, 1);
    try {
      await choices(alice).getByRole("button", { name: /Rock/ }).click();
      await choices(bob)
        .getByRole("button", { name: /Scissors/ })
        .click();
      await expect(alice.page.getByRole("heading", { name: "You won!" })).toBeVisible();
      await expect(bob.page.getByText(/^Rematch available for/)).toHaveText(/^Rematch available for 0:0\d$/);

      for (const player of [alice, bob]) {
        await expect(player.page.getByRole("heading", { name: "Room closed" })).toBeVisible({
          timeout: 15_000,
        });
        await expect(
          player.page.getByText("The time for a rematch is over, so the room closed."),
        ).toBeVisible();
      }
      await alice.page.reload();
      await expect(alice.page.getByText("The time for a rematch is over, so the room closed.")).toBeVisible();
      await expect(alice.page).toHaveTitle("Room closed · ClassiCade");

      // A friend opens the old link later on: the same explanation, not "doesn't exist".
      const friend = await players.open("friend");
      await joinAsGuest(friend, alice.url());
      await expect(
        friend.page.getByText("The time for a rematch is over, so the room closed."),
      ).toBeVisible();
      await friend.page.getByRole("link", { name: "Start a new Rock Paper Scissors game" }).click();
      await expect(friend.page).toHaveURL(RPS);
      await expect(friend.page.getByRole("button", { name: "Create room" })).toBeVisible();
      await friend.leave();
    } finally {
      // Back to the standard lifetimes for whatever runs next.
      alice.expectRestart();
      bob.expectRestart();
      await restartServer();
    }
  });
});
