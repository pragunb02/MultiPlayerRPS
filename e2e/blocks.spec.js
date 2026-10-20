import { expect, header, test } from "./fixtures.js";

// Two guests who just played (CC-044, ADR-053). Alice blocks Bob from his seat. From then on no rematch starts
// between them, and Bob sees only what any opponent could do: Alice declining. Bob cannot sit in Alice's next room and
// is told only that it is full, and is never told he was blocked. Once Alice unblocks him from her profile, he can
// join again.

/** A guest from the home page's button, the way in that needs no invite link. */
async function asGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  const name = (await header(player.page)).getByText(/^Guest-/);
  await expect(name).toBeVisible();
  return name.textContent();
}

/** The host opens a best-of-1 Rock Paper Scissors room from the lobby. Answers the invite link. */
async function openRps(host) {
  await host.page.goto("/games/rock-paper-scissors");
  await host.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await host.page.getByRole("button", { name: "Create room" }).click();
  return host.page.getByRole("textbox", { name: "Invite link" }).inputValue();
}

const choices = (player) => player.page.getByRole("group", { name: "Your choice" });

test.describe("blocks", () => {
  test("after a block a rematch looks declined, the pair can't sit together, and unblocking undoes it", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    const aliceName = await asGuest(alice);
    const bobName = await asGuest(bob);
    const invite = await openRps(alice);
    await bob.page.goto(invite);
    await choices(alice).getByRole("button", { name: /Rock/ }).click();
    await choices(bob)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(alice.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();
    const bobFramesBefore = bob.record.socketFrames.length;

    // Alice blocks Bob from his seat, after saying yes in the dialog.
    await alice.page.getByRole("button", { name: `Block ${bobName}` }).click();
    const dialog = alice.page.getByRole("dialog", { name: `Block ${bobName}?` });
    await expect(dialog).toContainText(`${bobName} is not told.`);
    // The dialog covers the whole page, not only the seat it was opened from.
    const backdrop = await dialog.evaluate((element) => {
      const { width, height } = element.parentElement.getBoundingClientRect();
      return { width: Math.round(width), height: Math.round(height) };
    });
    expect(backdrop).toEqual(alice.page.viewportSize());
    await dialog.getByRole("button", { name: "Block", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(alice.page.getByText(`You blocked ${bobName}.`)).toBeVisible();
    await expect(alice.page.getByRole("list", { name: "Players" }).getByText("blocked")).toBeVisible();

    // Bob asks for a rematch as anyone would. Even when Alice says yes, no game starts: Bob sees a plain decline.
    await bob.page.getByRole("button", { name: "Rematch" }).click();
    await expect(bob.page.getByText(`Waiting for ${aliceName}…`)).toBeVisible();
    await alice.page.getByRole("button", { name: "Accept rematch" }).click();
    await expect(bob.page.getByText(`${aliceName} declined the rematch.`)).toBeVisible();
    for (const player of [alice, bob]) {
      await expect(player.page.getByRole("heading", { name: /^You (won|lost)/ })).toBeVisible();
      await expect(choices(player)).toHaveCount(0);
    }

    // Bob cannot sit in Alice's next room. He is told it is full, as for any full room.
    await alice.page.getByRole("button", { name: "Leave room" }).click();
    const next = await openRps(alice);
    await bob.page.goto(next);
    await expect(bob.page.getByRole("heading", { name: "Can't join this room" })).toBeVisible();
    await expect(bob.page.getByText("This room is full")).toBeVisible();
    // Nothing Bob's browser received names the block.
    expect(bob.record.socketFrames.slice(bobFramesBefore).join("\n")).not.toMatch(/block/i);
    await expect(bob.page.getByText(/blocked/i)).toHaveCount(0);

    // Alice unblocks him from her profile, and he can join her waiting room.
    await alice.page.goto("/profile");
    const blocked = alice.page.getByRole("list", { name: "Blocked players" });
    await expect(blocked.getByText(bobName)).toBeVisible();
    await blocked.getByRole("button", { name: `Unblock ${bobName}` }).click();
    await expect(alice.page.getByText(`${bobName} is unblocked.`)).toBeVisible();
    await expect(alice.page.getByText("You haven't blocked anyone.")).toBeVisible();
    await alice.page.goto(new URL(next).pathname);
    await bob.page.goto(next);
    await expect(choices(bob)).toBeVisible();
  });

  test("the server refuses to block a stranger, whatever the page sends", async ({ players }) => {
    const alice = await players.open("alice");
    const mallory = await players.open("mallory");
    await asGuest(alice);
    await asGuest(mallory);
    const invite = await openRps(alice);
    const code = new URL(invite).pathname.split("/").at(-1);
    mallory.expect(404, "/api/blocks");

    const refused = await mallory.page.request.post("/api/blocks", {
      data: { roomCode: code, seat: 0, seatId: "guest_00000000-0000-4000-8000-000000000000" },
    });

    expect(refused.status()).toBe(404);
    expect((await refused.json()).error).toEqual(
      expect.objectContaining({ code: "NOT_FOUND", message: "You can only block someone you played with" }),
    );
    await mallory.page.goto("/profile");
    await expect(mallory.page.getByText("You haven't blocked anyone.")).toBeVisible();
  });
});
