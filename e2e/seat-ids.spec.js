import { expect, header, test } from "./fixtures.js";

// CC-253: what a browser receives about a room names the other players by opaque seat ids, never by their player
// ids. A seat id stays the same through a rematch and is different in the next room.

/** A guest from the home page's button. Answers the guest's own player id, from their own session. */
async function asGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  await expect((await header(player.page)).getByText(/^Guest-/)).toBeVisible();
  const session = await (await player.page.request.get("/api/session")).json();
  return session.identity.id;
}

/** Alice hosts best-of-1 Rock Paper Scissors and Bob joins by the invite link. */
async function openRps(alice, bob) {
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await bob.page.goto(invite);
}

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

async function playRound(winner, loser) {
  await choices(winner).getByRole("button", { name: /Rock/ }).click();
  await choices(loser)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(winner.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await expect(loser.page.getByRole("heading", { name: "You lost" })).toBeVisible();
}

/** Every room view in the WebSocket frames a browser received, pushed or answered, oldest first. */
function roomViews(player) {
  return player.record.socketFrames.flatMap((frame) => {
    const json = frame.replace(/^\d+/, "");
    if (!json.startsWith("[")) return [];
    const values = JSON.parse(json).flat();
    return values.filter((value) => Array.isArray(value?.seats) && typeof value?.you === "string");
  });
}

/** The seat id the views showed for the other player. */
const opponentSeat = (view) => view.seats.find((seat) => seat.playerId !== view.you).playerId;

test.describe("seat ids", () => {
  test("no browser receives the other player's id, and seat ids hold through a rematch but not into a new room", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    const aliceId = await asGuest(alice);
    const bobId = await asGuest(bob);
    await openRps(alice, bob);
    await playRound(alice, bob);
    const firstGame = roomViews(alice).at(-1);

    await alice.page.getByRole("button", { name: "Rematch" }).click();
    await bob.page.getByRole("button", { name: "Accept rematch" }).click();
    await expect(choices(alice)).toBeVisible();
    await playRound(bob, alice);
    const rematch = roomViews(alice).at(-1);
    await alice.page.getByRole("button", { name: "Leave room" }).click();
    await openRps(alice, bob);
    await expect(choices(bob)).toBeVisible();
    const nextRoom = roomViews(alice).at(-1);

    expect(alice.record.socketFrames.join("\n")).not.toContain(bobId);
    expect(bob.record.socketFrames.join("\n")).not.toContain(aliceId);
    expect(firstGame.you).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(rematch.game.number).toBe(2);
    expect([rematch.you, opponentSeat(rematch)]).toEqual([firstGame.you, opponentSeat(firstGame)]);
    expect(nextRoom.code).not.toBe(firstGame.code);
    expect(nextRoom.you).not.toBe(firstGame.you);
    expect(opponentSeat(nextRoom)).not.toBe(opponentSeat(firstGame));
  });
});
