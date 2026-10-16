import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { clockOn, startTestServer } from "../../testing/testApp.js";
import { createGamificationRoutes } from "./gamificationRoutes.js";

// Race engine, seed 42: bob moves first. Bob +1, Alice +2 → Alice wins.
// On 2026-10-16 Alice (first guest) has: variety-2, win-1, chess-play-1; Bob (second): variety-2, win-1, chess-win-1.
const DAY = "2026-10-16";
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

async function playRace(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
}

const get = async (path, cookie) => {
  const res = await fetch(`${server.baseUrl}/api${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json() };
};

/** Resolves with the first push of `event` that `accept`s it. */
const nextMatching = (socket, event, accept) =>
  new Promise((resolve) => {
    const handler = (payload) => {
      if (accept(payload)) {
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });

describe("achievements, streaks and quests end to end", () => {
  it.each(["/achievements", "/streaks", "/quests"])("GET %s requires a session", async (path) => {
    server = await startTestServer({ now: clockOn(DAY) });

    const { status, body } = await get(path);

    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("starts a new player with locked achievements, no streak and today's three quests", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const carol = await clients.player();

    const achievements = (await get("/achievements", carol.cookie)).body.achievements;
    const { streaks } = (await get("/streaks", carol.cookie)).body;
    const { quests } = (await get("/quests", carol.cookie)).body;

    expect(achievements).toHaveLength(15);
    expect(achievements.every((a) => a.unlockedAt === null)).toBe(true);
    expect(streaks).toEqual({
      win: { current: 0, best: 0 },
      daily: { current: 0, best: 0, lastDay: "", playedToday: false, atRisk: false },
    });
    expect(quests).toEqual(
      expect.objectContaining({
        day: DAY,
        resetsAt: Date.parse("2026-10-17T00:00:00.000Z"),
        sweep: { bonusXp: 30, completedAt: null },
      }),
    );
    expect(quests.items.map((q) => q.id)).toEqual(["variety-2", "win-1", "chess-play-1"]);
  });

  it("counts a match: quests, streaks and achievements move, and each player is told only their own", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const alice = await clients.player();
    const bob = await clients.player();
    const carol = await clients.player();
    const aliceUnlocks = nextEvent(alice.socket, SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED);
    const aliceQuests = nextEvent(alice.socket, SOCKET_EVENTS.QUESTS_UPDATED);
    const aliceStreaks = nextEvent(alice.socket, SOCKET_EVENTS.STREAKS_UPDATED);
    const aliceQuestXp = nextMatching(
      alice.socket,
      SOCKET_EVENTS.PROGRESS_UPDATED,
      (p) => p.source === "quest",
    );
    const bobUnlocks = nextEvent(bob.socket, SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED);

    await playRace(alice, bob);

    expect((await aliceUnlocks).achievements.map((a) => a.id)).toEqual(["first-match", "first-win"]);
    expect((await bobUnlocks).achievements.map((a) => a.id)).toEqual(["first-match"]);
    expect((await aliceQuests).quests.items.map((q) => [q.id, q.progress])).toEqual([
      ["variety-2", 1],
      ["win-1", 1],
      ["chess-play-1", 0],
    ]);
    expect((await aliceStreaks).streaks.win).toEqual({ current: 1, best: 1 });
    expect(await aliceQuestXp).toEqual(
      expect.objectContaining({ key: `quest:${DAY}:win-1`, matchId: "", xpGained: 20 }),
    );
    await server.tasks.drain();

    const quests = (await get("/quests", alice.cookie)).body.quests;
    expect(quests.items.find((q) => q.id === "win-1").completedAt).toEqual(expect.any(Number));
    expect((await get("/streaks", alice.cookie)).body.streaks.daily).toEqual(
      expect.objectContaining({ current: 1, lastDay: DAY, playedToday: true }),
    );
    const unlocked = (await get("/achievements", alice.cookie)).body.achievements.filter((a) => a.unlockedAt);
    expect(unlocked.map((a) => a.id)).toEqual(["first-match", "first-win"]);
    // Nothing reached the bystander.
    const gamificationEvents = [
      SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED,
      SOCKET_EVENTS.QUESTS_UPDATED,
      SOCKET_EVENTS.STREAKS_UPDATED,
      SOCKET_EVENTS.PROGRESS_UPDATED,
    ];
    expect(carol.received.filter((r) => gamificationEvents.includes(r.event))).toEqual([]);
  });

  it("checks its dependencies at construction", () => {
    expect(() => createGamificationRoutes({ now: Date.now })).toThrow(TypeError);
    expect(() => createGamificationRoutes({ gamificationComponent: {} })).toThrow(TypeError);
  });
});
