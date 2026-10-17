import { createRoom, expect, joinAsGuest, test } from "./fixtures.js";

// Fair play (CC-095): a game somebody leaves before playing gives nobody XP or a win, and the player is told why.
test.describe("fair play", () => {
  test("an instant forfeit gives no XP and no win, and says the game didn't count", async ({ players }) => {
    const alice = await players.open("alice");
    const room = await createRoom(alice, "tic-tac-toe");
    const bob = await players.open("bob");
    await joinAsGuest(bob, room.path);
    await expect(bob.page.getByRole("grid", { name: "Tic-Tac-Toe board" })).toBeVisible();

    await bob.page.getByRole("button", { name: "Leave room" }).click();
    await bob.page.getByRole("button", { name: "Leave and forfeit" }).click();

    // The game still ends with a winner, but gives the winner nothing.
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    const message = "This game didn't count: it ended too soon";
    // The toasts' live region holds only the toast, the room's own status region holds the result.
    const toasts = alice.page.getByRole("status").filter({ hasText: new RegExp(`^${message}$`) });
    await expect(toasts).toBeVisible();
    // The same words stay under the result banner, and no XP shows anywhere.
    await expect(alice.page.locator("p", { hasText: message })).toBeVisible();
    await expect(alice.page.getByText(/\+\d+ XP/)).toHaveCount(0);

    const { progress } = await (await alice.page.request.get("/api/progress")).json();
    expect(progress).toEqual(expect.objectContaining({ xp: 0, wins: 0, matchesPlayed: 0 }));
  });
});
