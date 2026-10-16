import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// CC-032: a guest's XP and match history move to the account they sign up for or log in to.
// Race engine, seed 42: the second seat moves first. Bob +1, Alice +2 → Alice (the host) wins.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };

async function post(path, body, cookie) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, body: await res.json(), cookie: setCookie ? setCookie.split(";")[0] : cookie };
}

const get = async (path, cookie) =>
  (await fetch(`${server.baseUrl}/api${path}`, { headers: { cookie } })).json();

/** Alice (host) beats Bob once; resolves when the match and its XP are stored. */
async function aliceBeatsBob(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await server.tasks.drain();
}

describe("a guest's progress follows them to their account (CC-032)", () => {
  it("signing up brings the guest's XP and matches, and says what moved", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);

    const signedUp = await post("/api/auth/signup", RIYA, alice.cookie);
    const { progress } = await get("/progress", signedUp.cookie);
    const { matches } = await get("/matches", signedUp.cookie);
    const { match } = await get(`/matches/${matches[0].matchId}`, signedUp.cookie);

    expect(signedUp.status).toBe(201);
    expect(signedUp.body.carriedOver).toEqual({ xp: 30, matchesPlayed: 1, matches: 1 });
    expect(progress).toEqual(expect.objectContaining({ xp: 30, matchesPlayed: 1, wins: 1 }));
    expect(matches).toHaveLength(1);
    expect(matches[0].outcomeForYou).toBe("win");
    expect(match.players.map((p) => p.displayName)).toEqual(["Riya", bob.identity.displayName]);
    expect(match.log.map((entry) => entry.playerId)).not.toContain(alice.identity.id);
  });

  it("logging in adds the guest's XP to the account's and joins the histories", async () => {
    server = await startTestServer();
    const account = await post("/api/auth/signup", RIYA);
    const accountSocket = await clients.openSocket(account.cookie);
    const opponent = await clients.player();
    await aliceBeatsBob({ socket: accountSocket }, opponent); // the account wins once: 30 XP
    const guest = await clients.player();
    const friend = await clients.player();
    await aliceBeatsBob(friend, guest); // the guest loses once: 10 XP

    const loggedIn = await post(
      "/api/auth/login",
      { email: RIYA.email, password: RIYA.password },
      guest.cookie,
    );
    const { progress } = await get("/progress", loggedIn.cookie);
    const { matches } = await get("/matches", loggedIn.cookie);

    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.carriedOver).toEqual({ xp: 10, matchesPlayed: 1, matches: 1 });
    expect(progress).toEqual(expect.objectContaining({ xp: 40, matchesPlayed: 2, wins: 1, losses: 1 }));
    expect(matches.map((m) => m.outcomeForYou).sort()).toEqual(["loss", "win"]);
  });

  it("a guest who hasn't played brings nothing, and the answer says nothing about it", async () => {
    server = await startTestServer();
    const guest = await clients.player();

    const signedUp = await post("/api/auth/signup", RIYA, guest.cookie);

    expect(signedUp.body).toEqual({ identity: expect.objectContaining({ displayName: "Riya" }) });
  });

  it("signing in without a guest session moves nothing", async () => {
    server = await startTestServer();
    await post("/api/auth/signup", RIYA);

    const loggedIn = await post("/api/auth/login", { email: RIYA.email, password: RIYA.password });

    expect(loggedIn.body).not.toHaveProperty("carriedOver");
  });

  it("moves the guest's data exactly once, however often the move is repeated", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);
    const signedUp = await post("/api/auth/signup", RIYA, alice.cookie);
    const move = () =>
      server.playerTransferComponent.transfer({
        from: alice.identity.id,
        to: signedUp.body.identity,
        now: Date.now(),
      });

    const repeats = await Promise.all([move(), move(), move()]);

    expect(repeats).toEqual([{}, {}, {}]);
    expect((await get("/progress", signedUp.cookie)).progress.xp).toBe(30);
    expect((await get("/matches", signedUp.cookie)).matches).toHaveLength(1);
  });

  it("moves the guest's data once when two sign-ins from the same guest session race", async () => {
    server = await startTestServer();
    await post("/api/auth/signup", RIYA);
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);
    const login = () => post("/api/auth/login", { email: RIYA.email, password: RIYA.password }, alice.cookie);

    const [first, second] = await Promise.all([login(), login()]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await get("/progress", first.cookie)).progress.xp).toBe(30);
    expect((await get("/matches", second.cookie)).matches).toHaveLength(1);
  });

  it("a match that finishes while its guest signs in lands on the account", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
    await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });

    // The winning move and the sign-up race each other.
    const [signedUp] = await Promise.all([
      post("/api/auth/signup", RIYA, alice.cookie),
      send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } }),
    ]);
    await server.tasks.drain();

    const { progress } = await get("/progress", signedUp.cookie);
    const { matches } = await get("/matches", signedUp.cookie);
    expect(progress).toEqual(expect.objectContaining({ xp: 30, matchesPlayed: 1 }));
    expect(matches).toHaveLength(1);
  });

  it("never fails the sign-in when moving data fails; housekeeping finishes the move later", async () => {
    let failNext = true;
    server = await startTestServer({
      transferParticipants: (participants) => [
        ...participants,
        {
          name: "flaky",
          transferPlayer: async () => {
            if (failNext) {
              failNext = false;
              throw new Error("database briefly down");
            }
            return { moved: {} };
          },
        },
      ],
    });
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);

    const signedUp = await post("/api/auth/signup", RIYA, alice.cookie);
    const resumed = await server.playerTransferComponent.resumePending({ now: Date.now() + 60_000 });

    expect(signedUp.status).toBe(201);
    expect(signedUp.body).not.toHaveProperty("carriedOver");
    expect(server.find("moving the previous identity's data failed")[0]).toEqual(
      expect.objectContaining({ playerId: signedUp.body.identity.id, previousPlayerId: alice.identity.id }),
    );
    expect(resumed).toEqual({ completed: [alice.identity.id], failed: [] });
    expect((await get("/progress", signedUp.cookie)).progress.xp).toBe(30);
  });
});
