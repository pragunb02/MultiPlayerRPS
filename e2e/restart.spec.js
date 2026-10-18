import { createRoom, expect, header, joinAsGuest, test } from "./fixtures.js";
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
  const name = (await header(player.page)).getByText(/^Guest-/);
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
    await expect(seats(player)).not.toContainText(/reconnecting|offline|away/, { timeout: 20_000 });
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
    await expect(seats(x)).not.toContainText(/reconnecting|offline|away/);
    await cell(x, "top centre").click();
    await cell(o, "bottom left").click();
    await cell(x, "top right").click();
    await expect(x.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
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

test.describe("a full server (CC-107)", () => {
  test("a player who wants a new room while the server is full is told to try again in a minute", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    await createRoom(alice, "tic-tac-toe");
    // Alice closes her browser. Her room stays, and a browser that is not open sees nothing of the restarts.
    await alice.leave();
    // One room at most, for this server process only. Alice's room is already there, so the server is full.
    await restartServer({ rooms: { limits: { openRoomsMax: 1 } } });
    try {
      const bob = await players.open("bob");
      await asGuest(bob);
      await bob.page.goto("/games/rock-paper-scissors");
      await bob.page.getByRole("button", { name: "Create room" }).click();

      await expect(bob.page.getByRole("alert")).toHaveText("The server is busy, try again in a minute");
      await expect(bob.page).toHaveURL("/games/rock-paper-scissors");
      await bob.leave();
    } finally {
      // Back to the standard limits for whatever runs next.
      await restartServer();
    }
  });
});

test.describe("the server restarts during a game against the computer (CC-138)", () => {
  const phase = (player) => player.page.locator("[data-cc-phase]");
  const emptyCell = (player) =>
    board(player)
      .getByRole("gridcell", { name: /: empty$/ })
      .first();
  const marks = (player) => board(player).getByRole("gridcell", { name: /: [XO]$/ });

  test("Pip is back with the server and plays on, and the visitor's game is kept", async ({ players }) => {
    const visitor = await players.open("visitor");
    await visitor.page.goto("/games/tic-tac-toe");
    await visitor.page.getByRole("button", { name: "Play Pip" }).click();
    await expect(phase(visitor)).toHaveAttribute("data-cc-phase", "my-turn", { timeout: 15_000 });
    const room = visitor.url();
    await emptyCell(visitor).click();
    const before = await marks(visitor).count();

    await restartDuring([visitor]);

    // Pip's move came before or after the restart: either way it is the visitor's turn again in the same game.
    await expect(phase(visitor)).toHaveAttribute("data-cc-phase", /my-turn|finished/, { timeout: 15_000 });
    expect(await marks(visitor).count()).toBeGreaterThan(before);
    await expect(seats(visitor)).toContainText("Pipcomputer");
    expect(visitor.url()).toBe(room);
    if ((await phase(visitor).getAttribute("data-cc-phase")) === "my-turn") {
      const now = await marks(visitor).count();
      await emptyCell(visitor).click();
      await expect.poll(() => marks(visitor).count(), { timeout: 15_000 }).toBeGreaterThan(now + 1);
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
      await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
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
