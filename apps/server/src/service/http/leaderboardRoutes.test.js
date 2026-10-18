import { afterEach, describe, expect, it } from "vitest";
import { ENGINES } from "@classicade/games";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const get = async (path, cookie) => {
  const res = await fetch(`${server.baseUrl}/api${path}`, { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json() };
};

/** A new account with a connected socket. */
async function account(username) {
  const res = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Adults, so their names show on the public boards (CC-152).
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: "correct horse battery",
      birthYear: 1990,
    }),
  });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const { identity } = await res.json();
  return { identity, cookie, socket: await clients.openSocket(cookie) };
}

/** The player's XP and level, quest bonuses included (daily quests depend on the player and the day, CC-089). */
const progressOf = async (player) => {
  const { xp, level } = (await get("/progress", player.cookie)).body.progress;
  return { xp, level };
};

/** One game of Rock Paper Scissors (best of 1) that `winner` wins; resolves once the boards are updated. */
async function rps(winner, loser) {
  const { code } = await startRoom(winner, loser, { gameId: "rps", options: { bestOf: 1 } });
  await send(winner.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "rock" } });
  await send(loser.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "scissors" } });
  await server.tasks.drain();
}

describe("leaderboard routes", () => {
  it("lists the boards without a session", async () => {
    server = await startTestServer();

    const { status, body } = await get("/leaderboards");

    expect(status).toBe(200);
    expect(body.boards.map((board) => board.id)).toEqual([
      "overall",
      "weekly",
      "rock-paper-scissors",
      "tic-tac-toe",
      "chess",
    ]);
  });

  it("ranks accounts by XP and by wins — never guests — with public fields only", async () => {
    server = await startTestServer({ engines: ENGINES });
    const riya = await account("riya");
    const sam = await account("sam");
    const guest = await clients.player();
    await rps(riya, sam);
    await rps(riya, guest);
    await rps(guest, sam);

    const overall = await get("/leaderboards/overall");
    const wins = await get("/leaderboards/rock-paper-scissors");

    const riyaNow = await progressOf(riya);
    const samNow = await progressOf(sam);

    // 60 and 20 XP from the matches, plus whatever daily quests paid.
    expect(riyaNow.xp).toBeGreaterThanOrEqual(60);
    expect(samNow.xp).toBeGreaterThanOrEqual(20);
    expect(overall.body.entries).toEqual([
      { rank: 1, displayName: "riya", level: riyaNow.level, score: riyaNow.xp },
      { rank: 2, displayName: "sam", level: samNow.level, score: samNow.xp },
    ]);
    expect(wins.body.entries).toEqual([{ rank: 1, displayName: "riya", level: riyaNow.level, score: 2 }]);
    expect(overall.body).not.toHaveProperty("you");
    expect(JSON.stringify(overall.body)).not.toMatch(/user_|guest_|@/);
  });

  it("tells the viewer where they stand", async () => {
    server = await startTestServer({ engines: ENGINES });
    const riya = await account("riya");
    const sam = await account("sam");
    const guest = await clients.player();
    await rps(riya, sam);
    const riyaNow = await progressOf(riya);
    const samNow = await progressOf(sam);

    expect((await get("/leaderboards/overall?limit=1", sam.cookie)).body).toEqual(
      expect.objectContaining({
        entries: [{ rank: 1, displayName: "riya", level: riyaNow.level, score: riyaNow.xp }],
        you: { listed: true, rank: 2, score: samNow.xp },
      }),
    );
    expect((await get("/leaderboards/chess", sam.cookie)).body.you).toEqual({
      listed: false,
      reason: "unranked",
    });
    expect((await get("/leaderboards/overall", guest.cookie)).body.you).toEqual({
      listed: false,
      reason: "guest",
    });
  });

  it("counts quest bonus XP on the overall and this week's boards (CC-089)", async () => {
    server = await startTestServer({ engines: ENGINES });
    const riya = await account("riya");
    const sam = await account("sam");
    await rps(riya, sam);
    const weekBefore = (await get("/leaderboards/weekly", riya.cookie)).body.you.score;

    // How a completed quest pays out: progression awards it once and announces it.
    await server.progressionComponent.awardBonus({
      playerId: riya.identity.id,
      displayName: "riya",
      key: "quest:2026-10-16:extra",
      xp: 500,
      at: Date.now(),
    });
    await server.tasks.drain();
    const riyaNow = await progressOf(riya);

    expect((await get("/leaderboards/weekly", riya.cookie)).body.you).toEqual({
      listed: true,
      rank: 1,
      score: weekBefore + 500,
    });
    expect((await get("/leaderboards/overall?limit=1")).body.entries).toEqual([
      { rank: 1, displayName: "riya", level: riyaNow.level, score: riyaNow.xp },
    ]);
  });

  it("puts a guest's carried-over XP and wins on the boards once they sign up (CC-032)", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();
    const bob = await clients.player();
    await rps(alice, bob);
    expect((await get("/leaderboards/overall")).body.entries).toEqual([]);

    const res = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({
        username: "riya",
        email: "riya@example.com",
        password: "correct horse battery",
        birthYear: 1990,
      }),
    });
    const riya = { cookie: res.headers.get("set-cookie").split(";")[0] };
    const { xp, level } = await progressOf(riya);

    expect(res.status).toBe(201);
    expect(xp).toBeGreaterThanOrEqual(30);
    expect((await get("/leaderboards/overall", riya.cookie)).body).toEqual(
      expect.objectContaining({
        entries: [{ rank: 1, displayName: "riya", level, score: xp }],
        you: { listed: true, rank: 1, score: xp },
      }),
    );
    expect((await get("/leaderboards/rock-paper-scissors")).body.entries).toEqual([
      { rank: 1, displayName: "riya", level, score: 1 },
    ]);
    // This week's board counts the moved match.
    expect((await get("/leaderboards/weekly", riya.cookie)).body.you.score).toBeGreaterThanOrEqual(30);
  });

  it("describes the weekly board with its ISO week and reset time", async () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    server = await startTestServer({ now: () => now });

    const { body } = await get("/leaderboards/weekly");

    expect(body).toEqual({
      board: {
        id: "weekly",
        name: "This week",
        metric: "xp",
        period: "week",
        periodId: "2026-W42",
        resetsAt: Date.parse("2026-10-19T00:00:00Z"),
      },
      entries: [],
    });
  });

  it("answers 404 for an unknown board", async () => {
    server = await startTestServer();

    const { status, body } = await get("/leaderboards/ludo");

    expect(status).toBe(404);
    expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it.each([["?limit=0"], ["?limit=51"], ["?limit=ten"], ["?page=2"]])("rejects %s", async (query) => {
    server = await startTestServer();

    const { status, body } = await get(`/leaderboards/overall${query}`);

    expect(status).toBe(400);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rate-limits a client that keeps asking", async () => {
    server = await startTestServer({ leaderboardLimit: { windowMs: 60_000, limit: 2 } });
    await get("/leaderboards");
    await get("/leaderboards/overall");

    const { status, body } = await get("/leaderboards/overall");

    expect(status).toBe(429);
    expect(body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });
});
