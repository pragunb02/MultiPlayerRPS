import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { clockOn, startTestServer } from "../../testing/testApp.js";
import { flagPaths } from "../../testing/flagPaths.js";
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

// The time zone and local reset times (CC-146). A fixed clock: nothing here reads the real time (CC-325).
const FIXED_NOW = Date.parse("2026-10-21T10:00:00.000Z");

const put = async (path, body, cookie) => {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), cacheControl: res.headers.get("cache-control") };
};

describe("time zone routes (CC-146)", () => {
  flagPaths("local_days", (on) => {
    it(on ? "sets the zone from the browser, once in 7 days" : "answers 404 and keeps UTC days", async () => {
      server = await startTestServer({ now: () => FIXED_NOW });
      if (on) {
        await server.flagComponent.setRollout({ name: "local_days", rollout: "on" });
      }
      const carol = await clients.player();

      if (!on) {
        expect((await get("/time-zone", carol.cookie)).status).toBe(404);
        expect((await put("/time-zone", { zone: "America/New_York" }, carol.cookie)).status).toBe(404);
        const { streaks } = (await get("/streaks", carol.cookie)).body;
        expect(streaks.daily).not.toHaveProperty("resetsAt");
        expect((await get("/quests", carol.cookie)).body.quests.resetsAt).toBe(
          Date.parse("2026-10-22T00:00:00Z"),
        );
        return;
      }
      expect((await get("/time-zone", carol.cookie)).body.timeZone).toMatchObject({ chosen: false });

      const set = await put("/time-zone", { zone: "America/New_York" }, carol.cookie);
      expect(set.status).toBe(200);
      expect(set.cacheControl).toBe("no-store");
      expect(set.body.timeZone).toEqual({
        zone: "America/New_York",
        chosen: true,
        changeableAt: FIXED_NOW + 7 * 24 * 60 * 60 * 1000,
        // The change applies from India's midnight, then New York's days follow.
        dayEndsAt: Date.parse("2026-10-21T18:30:00Z"),
      });

      const locked = await put("/time-zone", { zone: "Europe/London" }, carol.cookie);
      expect(locked.status).toBe(409);
      expect(locked.body.error.details).toEqual({
        reason: "zone-locked",
        changeableAt: FIXED_NOW + 7 * 24 * 60 * 60 * 1000,
      });
      expect((await put("/time-zone", { zone: "Mars/Base" }, carol.cookie)).status).toBe(400);
      expect((await put("/time-zone", { zone: "America/New_York" }, carol.cookie)).status).toBe(200);

      const { streaks } = (await get("/streaks", carol.cookie)).body;
      expect(streaks.daily).toMatchObject({ current: 0, resetsAt: Date.parse("2026-10-21T18:30:00Z") });
      expect(streaks.daily).not.toHaveProperty("freezes");
    });
  });

  it("requires a session", async () => {
    server = await startTestServer({ now: () => FIXED_NOW });
    expect((await get("/time-zone")).status).toBe(401);
    expect((await put("/time-zone", { zone: "UTC" })).status).toBe(401);
  });
});

describe("streak freezes over the API (CC-145)", () => {
  flagPaths("streak_freezes", (on) => {
    it(on ? "shows the freezes beside the daily streak" : "shows no freezes", async () => {
      server = await startTestServer({ now: () => FIXED_NOW });
      if (on) {
        await server.flagComponent.setRollout({ name: "streak_freezes", rollout: "on" });
      }
      const carol = await clients.player();
      const { daily } = (await get("/streaks", carol.cookie)).body.streaks;
      if (on) {
        expect(daily.freezes).toEqual({ held: 0, max: 2, covering: 0, earnBackLeft: 0 });
        expect(daily.nextMilestone).toBe(3);
      } else {
        expect(daily).toEqual({ current: 0, best: 0, lastDay: "", playedToday: false, atRisk: false });
      }
    });
  });
});
