import { hasPlayerIdShape } from "../apps/server/src/models/playerIdShape.js";
import { expect, test } from "./fixtures.js";
import { OWNER } from "./ownerConsole.js";
import { BASE_URL } from "./personas.js";

// Quick match (CC-051, ADR-079): with its flag on, the main Play button looks for a person for up to 4 s while the
// character's game is made ready. Two visitors pressing Play meet; one alone plays the character after the search;
// Cancel stays on the page. The flag is one setting on the shared server and every Play press reads it, so this
// file runs on its own after all the others, like the restart tests (shards.js), and sends the flag back to its
// rollout in code when it ends.

const RPS = "/games/rock-paper-scissors";
const roomPath = /^\/games\/rock-paper-scissors\/rooms\/[A-Z0-9]{6}$/;
const seats = (player) => player.page.getByRole("list", { name: "Players" });

async function setQuickMatch(players, rollout) {
  const owner = await players.open("owner", { secrets: [OWNER.password, OWNER.email] });
  await owner.page.goto("/login");
  await owner.page.getByLabel("Email").fill(OWNER.email);
  await owner.page.getByLabel("Password").fill(OWNER.password);
  await owner.page.getByRole("button", { name: "Log in" }).click();
  await expect(owner.page).toHaveURL("/");
  const answer =
    rollout === "code"
      ? await owner.page.request.delete("/api/admin/flags/quick_match", { headers: { Origin: BASE_URL } })
      : await owner.page.request.put("/api/admin/flags/quick_match", {
          data: { rollout },
          headers: { Origin: BASE_URL },
        });
  expect(answer.ok()).toBe(true);
  await owner.leave();
}

/**
 * A guest on the game page, the quick match line showing. A guest's tab is connected, so it counts as someone on
 * the site for the liquidity gate (ADR-029): a visitor with no session yet is not connected at all.
 */
async function onGamePage(players, name) {
  const player = await players.open(name);
  await player.page.goto("/");
  await player.page.getByRole("button", { name: "Play as a guest" }).click();
  await expect(player.page.getByRole("banner").getByText(/^Guest-/)).toBeAttached();
  await player.page.goto(RPS);
  await expect(
    player.page.getByText(/First we look for a person to play, for up to 4 seconds/),
  ).toBeVisible();
  return player;
}

/** Every string in the socket frames a player received, for the player id crawl. */
const frameStrings = (player) =>
  player.record.socketFrames
    .flatMap((frame) => frame.match(/"(?:[^"\\]|\\.)*"/g) ?? [])
    .map((text) => text.slice(1, -1));

test.describe("quick match", () => {
  test.afterEach(async ({ players }) => {
    await setQuickMatch(players, "code");
  });

  test("two visitors pressing Play meet each other, and no player id reaches either browser", async ({
    players,
  }, testInfo) => {
    await setQuickMatch(players, "on");
    const riya = await onGamePage(players, "riya");
    const arjun = await onGamePage(players, "arjun");

    await riya.page.getByRole("button", { name: "Play Rocky" }).click();
    await expect(riya.page.getByText(/Still looking. If nobody is free, you play Rocky/)).toBeVisible();
    await riya.page.screenshot({ path: testInfo.outputPath("search.png") });
    await arjun.page.getByRole("button", { name: "Play Rocky" }).click();

    await expect.poll(() => riya.url()).toMatch(roomPath);
    await expect.poll(() => arjun.url()).toMatch(roomPath);
    expect(riya.url()).toBe(arjun.url());
    await expect(seats(riya).getByRole("listitem")).toHaveCount(2);
    await expect(seats(riya).getByText("Computer")).toHaveCount(0);
    await expect(seats(riya).getByText(/^Guest-/)).toHaveCount(2);
    await riya.page.screenshot({ path: testInfo.outputPath("matched.png") });

    const answers = riya.record.socketFrames.filter((frame) => frame.includes('"outcome":"person"'));
    expect(answers).toHaveLength(1);
    for (const player of [riya, arjun]) {
      expect(frameStrings(player).filter(hasPlayerIdShape)).toEqual([]);
    }
  });

  test("a visitor alone plays Rocky after the search, told that nobody was free", async ({
    players,
  }, testInfo) => {
    await setQuickMatch(players, "on");
    // Someone else is on the site, so the search runs; they never press Play.
    await onGamePage(players, "idle");
    const riya = await onGamePage(players, "riya");

    const pressed = Date.now();
    await riya.page.getByRole("button", { name: "Play Rocky" }).click();
    await expect(riya.page.getByText(/Looking for a person…/).first()).toBeVisible();
    await expect.poll(() => riya.url(), { timeout: 10_000 }).toMatch(roomPath);
    const waited = Date.now() - pressed;

    await expect(riya.page.getByText("Nobody was free just now, so you're playing Rocky.")).toBeVisible();
    await expect(seats(riya).getByText("Computer")).toBeVisible();
    expect(waited).toBeGreaterThanOrEqual(3_500);
    expect(waited).toBeLessThan(8_000);
    await riya.page.screenshot({ path: testInfo.outputPath("fallback.png") });
  });

  test("Cancel stops the search and stays on the game page", async ({ players }) => {
    await setQuickMatch(players, "on");
    await onGamePage(players, "idle");
    const riya = await onGamePage(players, "riya");

    await riya.page.getByRole("button", { name: "Play Rocky" }).click();
    const cancel = riya.page.locator('[data-cc-control="lobby.quick_match_cancel"]');
    await expect(cancel).toBeVisible();
    await cancel.click();

    await expect(riya.page.getByText(/Still looking. If nobody is free/)).toHaveCount(0);
    expect(riya.url()).toBe(RPS);
    await expect(riya.page.getByRole("button", { name: "Play Rocky" })).toBeEnabled();
  });
});
