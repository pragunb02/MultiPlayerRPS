import { expect, header, test } from "./fixtures.js";

// CC-297: match history names every player by an id made for that match. What a browser receives about past
// matches never holds the opponent's player id, and the profile still names the opponent.

/** A guest from the home page's button. Answers the guest's own identity, from their own session. */
async function asGuest(player) {
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  await expect((await header(player.page)).getByText(/^Guest-/)).toBeVisible();
  return (await (await player.page.request.get("/api/session")).json()).identity;
}

/** Alice hosts best-of-1 Rock Paper Scissors, Bob joins by the invite link, and Alice wins. */
async function playRps(alice, bob) {
  await alice.page.goto("/games/rock-paper-scissors");
  await alice.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await alice.page.getByRole("button", { name: "Create room" }).click();
  const invite = await alice.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await bob.page.goto(invite);
  const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
  await choices(alice).getByRole("button", { name: /Rock/ }).click();
  await choices(bob)
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(bob.page.getByRole("heading", { name: "You lost" })).toBeVisible();
}

test.describe("match history ids", () => {
  test("the profile names the opponent, and nothing the browser receives about the match holds their id", async ({
    players,
  }) => {
    const alice = await players.open("alice");
    const bob = await players.open("bob");
    const aliceIdentity = await asGuest(alice);
    await asGuest(bob);
    await playRps(alice, bob);

    const history = bob.page.waitForResponse((res) => new URL(res.url()).pathname === "/api/matches");
    await bob.page.goto("/profile");
    const listed = await (await history).json();
    const [match] = listed.matches;
    const details = await (await bob.page.request.get(`/api/matches/${match.matchId}`)).json();

    const list = bob.page.getByRole("list", { name: "Match history" });
    await expect(list.getByRole("listitem")).toHaveText([
      new RegExp(`^LostRock Paper Scissors vs ${aliceIdentity.displayName}`),
    ]);
    expect(JSON.stringify([listed, details])).not.toContain(aliceIdentity.id);
    expect(match.you).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(details.match.players.map((p) => p.playerId)).toEqual(match.players.map((p) => p.playerId));
  });
});
