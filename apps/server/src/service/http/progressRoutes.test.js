import { afterEach, describe, expect, it } from "vitest";
import { NOT_COUNTED_REASONS, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { clockOn, startTestServer } from "../../testing/testApp.js";

// Race engine, seed 42: bob moves first. Bob +1, Alice +2 → Alice wins.
// Quests depend on the day: on 2026-10-16 Alice (the first guest) has "Get a win" (+20 XP); on 2026-10-23 her
// quests need more than two races, so only match XP is awarded.
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

const getProgress = async (cookie) =>
  (await (await fetch(`${server.baseUrl}/api/progress`, { headers: { cookie } })).json()).progress;

describe("progression end to end", () => {
  it("pushes each player their XP after a match, and the API agrees (match XP plus quest XP)", async () => {
    server = await startTestServer({ now: clockOn("2026-10-16") });
    const alice = await clients.player();
    const bob = await clients.player();
    const alicePush = nextEvent(alice.socket, SOCKET_EVENTS.PROGRESS_UPDATED);
    const bobPush = nextEvent(bob.socket, SOCKET_EVENTS.PROGRESS_UPDATED);

    await playRace(alice, bob);

    expect(await alicePush).toEqual(
      expect.objectContaining({
        source: "match",
        xpGained: 30,
        leveledUp: false,
        progress: expect.objectContaining({ xp: 30, wins: 1 }),
      }),
    );
    expect((await bobPush).xpGained).toBe(10);
    await server.tasks.drain();
    expect(await getProgress(alice.cookie)).toEqual(
      expect.objectContaining({ xp: 50, level: 2, matchesPlayed: 1 }),
    );
  });

  it("delivers the level-up to the player's browser (BUG-08)", async () => {
    server = await startTestServer({ now: clockOn("2026-10-23") });
    const alice = await clients.player();
    const bob = await clients.player();
    // Wait until the first push has reached the client, so the next listener cannot catch it instead.
    const firstPush = nextEvent(alice.socket, SOCKET_EVENTS.PROGRESS_UPDATED);
    await playRace(alice, bob);
    expect((await firstPush).leveledUp).toBe(false);
    const levelUp = nextEvent(alice.socket, SOCKET_EVENTS.PROGRESS_UPDATED);

    await playRace(alice, bob); // 60 XP → level 2

    expect(await levelUp).toEqual(
      expect.objectContaining({ leveledUp: true, progress: expect.objectContaining({ level: 2 }) }),
    );
  });

  it("tells both players a game left at once didn't count, and gives nobody XP (CC-095)", async () => {
    server = await startTestServer({ now: clockOn("2026-10-16") });
    const alice = await clients.player();
    const bob = await clients.player();
    const alicePush = nextEvent(alice.socket, SOCKET_EVENTS.PROGRESS_UPDATED);
    const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });

    await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code });

    expect(await alicePush).toEqual(
      expect.objectContaining({
        source: "match",
        xpGained: 0,
        counted: false,
        notCountedReason: NOT_COUNTED_REASONS.ENDED_TOO_SOON,
      }),
    );
    await server.tasks.drain();
    expect(await getProgress(alice.cookie)).toEqual(expect.objectContaining({ xp: 0, matchesPlayed: 0 }));
    expect(await getProgress(bob.cookie)).toEqual(expect.objectContaining({ xp: 0, matchesPlayed: 0 }));
  });

  it("says a match that counted counted", async () => {
    server = await startTestServer({ now: clockOn("2026-10-23") });
    const alice = await clients.player();
    const bob = await clients.player();
    const push = nextEvent(alice.socket, SOCKET_EVENTS.PROGRESS_UPDATED);

    await playRace(alice, bob);

    expect(await push).toEqual(expect.objectContaining({ counted: true, notCountedReason: "" }));
  });

  it("reaches every open tab of the player", async () => {
    server = await startTestServer({ now: clockOn("2026-10-23") });
    const alice = await clients.player();
    const bob = await clients.player();
    const secondTab = await clients.openSocket(alice.cookie);
    const pushedToSecondTab = nextEvent(secondTab, SOCKET_EVENTS.PROGRESS_UPDATED);

    await playRace(alice, bob);

    expect((await pushedToSecondTab).xpGained).toBe(30);
  });

  it("starts at level 1 before any match, and requires a session", async () => {
    server = await startTestServer();
    const carol = await clients.player();

    expect(await getProgress(carol.cookie)).toEqual(
      expect.objectContaining({ xp: 0, level: 1, xpForNextLevel: 50 }),
    );
    expect((await fetch(`${server.baseUrl}/api/progress`)).status).toBe(401);
  });
});
