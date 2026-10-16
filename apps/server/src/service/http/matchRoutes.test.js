import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// Plays real games over sockets, then reads the history over HTTP. Race engine, seed 42: bob moves first.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const get = (path, cookie) => fetch(`${server.baseUrl}${path}`, { headers: cookie ? { cookie } : {} });

/** Alice hosts, Bob joins; Bob +1, Alice +2 → Alice wins. Resolves once the match has been recorded. */
async function playRace(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await server.matchRecorder.drain();
  return code;
}

describe("match history routes", () => {
  it("lists a finished game for both players, from each player's point of view", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    await playRace(alice, bob);

    const aliceList = await (await get("/api/matches", alice.cookie)).json();
    const bobList = await (await get("/api/matches", bob.cookie)).json();

    expect(aliceList.matches).toHaveLength(1);
    expect(aliceList.matches[0]).toEqual(
      expect.objectContaining({
        gameId: "race",
        outcomeForYou: "win",
        result: { result: "win", winners: [alice.identity.id], reason: "reached-target" },
      }),
    );
    expect(bobList.matches[0].outcomeForYou).toBe("loss");
    expect(aliceList).not.toHaveProperty("nextBefore");
  });

  it("returns the full record, with the move log, to a participant", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    await playRace(alice, bob);
    const [{ matchId }] = (await (await get("/api/matches", bob.cookie)).json()).matches;

    const { match } = await (await get(`/api/matches/${matchId}`, bob.cookie)).json();

    expect(match.seed).toBe(42);
    expect(match.log.map((entry) => entry.move)).toEqual([{ add: 1 }, { add: 2 }]);
  });

  it("answers 404 to someone who did not play the match", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    const carol = await clients.player();
    await playRace(alice, bob);
    const [{ matchId }] = (await (await get("/api/matches", alice.cookie)).json()).matches;

    const res = await get(`/api/matches/${matchId}`, carol.cookie);

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("requires a session", async () => {
    server = await startTestServer();

    expect((await get("/api/matches")).status).toBe(401);
  });

  it.each([
    ["/api/matches?limit=0", "limit"],
    ["/api/matches?limit=51", "limit"],
    ["/api/matches?limit=abc", "limit"],
    ["/api/matches?before=yesterday", "before"],
    ["/api/matches/not-a-uuid", "matchId"],
  ])("validates %s", async (path, field) => {
    server = await startTestServer();
    const alice = await clients.player();

    const res = await get(path, alice.cookie);

    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toEqual({ field });
  });

  it("pages newest first with nextBefore", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    await playRace(alice, bob);
    await new Promise((resolve) => setTimeout(resolve, 5)); // distinct end times
    await playRace(alice, bob);

    const first = await (await get("/api/matches?limit=1", alice.cookie)).json();
    const second = await (await get(`/api/matches?limit=1&before=${first.nextBefore}`, alice.cookie)).json();

    expect(first.matches).toHaveLength(1);
    expect(second.matches).toHaveLength(1);
    expect(second.matches[0].endedAt).toBeLessThan(first.matches[0].endedAt);
  });
});
