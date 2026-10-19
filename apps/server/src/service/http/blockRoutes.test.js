import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// CC-044, ADR-053: blocking over HTTP. The other player is named by a room code or a match id and a seat, never by
// an id, and only someone the server saw the caller play with can be blocked.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const NOT_PLAYED = { code: ERROR_CODES.NOT_FOUND, message: "You can only block someone you played with" };
const PASSWORD = "correct horse battery";

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    headers: res.headers,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
  };
}

const block = (player, target) => call("POST", "/blocks", { body: target, cookie: player.cookie });
const list = async (player) => (await call("GET", "/blocks", { cookie: player.cookie })).body.blocks;
const error = (res) => ({ code: res.body.error?.code, message: res.body.error?.message });

/** Alice hosts a race, Bob joins and moves first (seed 42), Alice wins. Resolves once the match is stored. */
async function finishedRace(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  const ended = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await server.tasks.drain();
  return { code, matchId: ended.data.game.matchId, seats: ended.data.seats };
}

const seatOf = (seats, player) => seats.findIndex((seat) => seat.playerId === player.identity.id);

describe("POST /api/blocks (CC-044)", () => {
  it("blocks the other player of a room both sit in, and answers the record without any player id", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, seats } = await finishedRace(alice, bob);

    const res = await block(alice, { roomCode: code, seat: seatOf(seats, bob) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      block: { blockId: expect.any(String), displayName: bob.identity.displayName, blockedAt: expect.any(Number) },
    });
    expect(JSON.stringify(res.body)).not.toContain(bob.identity.id);
    expect(await list(alice)).toEqual([res.body.block]);
  });

  it("blocks the other player of a stored match both played, after they left the room", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, matchId } = await finishedRace(alice, bob);
    await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code });
    const { body } = await call("GET", `/matches/${matchId}`, { cookie: alice.cookie });

    const res = await block(alice, { matchId, seat: seatOf(body.match.players, bob) });

    expect(res.status).toBe(200);
    expect(res.body.block.displayName).toBe(bob.identity.displayName);
  });

  it("answers 401 to a visitor without a session", async () => {
    server = await startTestServer();

    const res = await call("POST", "/blocks", { body: { roomCode: "ABCDEF", seat: 0 } });

    expect(res.status).toBe(401);
  });

  describe("IDOR: only someone the server saw you play with, never an id from the client", () => {
    it("refuses a stranger who names a room and seat they are not in, with the same 404 as any miss", async () => {
      server = await startTestServer();
      const [alice, bob, mallory] = [await clients.player(), await clients.player(), await clients.player()];
      const { code, matchId, seats } = await finishedRace(alice, bob);

      const answers = [
        await block(mallory, { roomCode: code, seat: seatOf(seats, alice) }),
        await block(mallory, { matchId, seat: 0 }),
        await block(mallory, { roomCode: "ZZZZZZ", seat: 0 }),
        await block(mallory, { matchId: "99999999-2222-4333-8444-555555555555", seat: 0 }),
        await block(alice, { roomCode: code, seat: seatOf(seats, alice) }),
        await block(alice, { roomCode: code, seat: 7 }),
      ];

      expect(answers.map((res) => res.status)).toEqual([404, 404, 404, 404, 404, 404]);
      expect(answers.map(error)).toEqual(answers.map(() => NOT_PLAYED));
      expect(await list(mallory)).toEqual([]);
      expect(await list(alice)).toEqual([]);
    });

    it("refuses a player id, or any field but the reference, so nobody blocks by id or for someone else", async () => {
      server = await startTestServer();
      const [alice, bob] = [await clients.player(), await clients.player()];
      const { code } = await finishedRace(alice, bob);

      const answers = [
        await block(alice, { playerId: bob.identity.id }),
        await block(alice, { roomCode: code, seat: 1, blockerId: bob.identity.id }),
        await block(alice, { roomCode: code, seat: 1, matchId: "11111111-2222-4333-8444-555555555555" }),
        await block(alice, { roomCode: code, seat: "1" }),
        await block(alice, { roomCode: code, seat: -1 }),
        await block(alice, { roomCode: "nope", seat: 1 }),
        await block(alice, { matchId: "not-a-match", seat: 1 }),
        await block(alice, [code, 1]),
      ];

      expect(answers.map((res) => res.status)).toEqual(answers.map(() => 400));
      expect(answers.map((res) => res.body.error.code)).toEqual(
        answers.map(() => ERROR_CODES.VALIDATION_FAILED),
      );
      expect(await list(alice)).toEqual([]);
      expect(await list(bob)).toEqual([]);
    });
  });

  describe("no enumeration of who blocked you", () => {
    it("shows the blocked player nothing: an empty list, nothing in their export, and the room refuses them like a full one", async () => {
      server = await startTestServer();
      const [alice, bob, carol] = [await clients.player(), await clients.player(), await clients.player()];
      const { code, seats } = await finishedRace(alice, bob);
      await block(alice, { roomCode: code, seat: seatOf(seats, bob) });
      const signedUp = await call("POST", "/auth/signup", {
        body: { username: "Bobby", email: "bobby@example.com", password: PASSWORD },
        cookie: bob.cookie,
      });

      const exported = await call("POST", "/account/export", {
        body: { password: PASSWORD },
        cookie: signedUp.cookie,
      });
      const fresh = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId: "race", options: {} });
      const bobSocket = await clients.openSocket(signedUp.cookie);
      const refused = await send(bobSocket, SOCKET_EVENTS.ROOM_JOIN, { code: fresh.data.code });
      // A room that really is full: every seat taken while the host is away, so the game waits (CC-112).
      const full = await send(carol.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId: "race", options: {} });
      await send(carol.socket, SOCKET_EVENTS.ROOM_AWAY, { code: full.data.code });
      const dave = await clients.player();
      await send(dave.socket, SOCKET_EVENTS.ROOM_JOIN, { code: full.data.code });
      const tooLate = await send(bobSocket, SOCKET_EVENTS.ROOM_JOIN, { code: full.data.code });

      expect(await list({ cookie: signedUp.cookie })).toEqual([]);
      expect(exported.body.blocks).toEqual([]);
      expect(JSON.stringify(exported.body)).not.toContain(alice.identity.id);
      expect(JSON.stringify(exported.body)).not.toContain(alice.identity.displayName);
      expect(tooLate).toEqual({ ok: false, error: { code: ERROR_CODES.CONFLICT, message: "This room is full" } });
      expect(refused).toEqual(tooLate);
    });
  });
});

describe("GET and DELETE /api/blocks (CC-044)", () => {
  it("unblocks with the record's id, after which the pair can sit together again", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, seats } = await finishedRace(alice, bob);
    const { body } = await block(alice, { roomCode: code, seat: seatOf(seats, bob) });

    const res = await call("DELETE", `/blocks/${body.block.blockId}`, { cookie: alice.cookie });
    const fresh = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId: "race", options: {} });
    const joined = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: fresh.data.code });

    expect(res.status).toBe(204);
    expect(await list(alice)).toEqual([]);
    expect(joined.ok).toBe(true);
  });

  it("answers the same 404 for someone else's block as for one that never existed, and keeps it", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, seats } = await finishedRace(alice, bob);
    const { body } = await block(alice, { roomCode: code, seat: seatOf(seats, bob) });

    const theirs = await call("DELETE", `/blocks/${body.block.blockId}`, { cookie: bob.cookie });
    const madeUp = await call("DELETE", "/blocks/00000000-0000-4000-9000-000000000000", { cookie: bob.cookie });
    const notAnId = await call("DELETE", "/blocks/abc", { cookie: bob.cookie });

    expect([theirs.status, madeUp.status]).toEqual([404, 404]);
    expect(error(theirs)).toEqual(error(madeUp));
    expect(notAnId.status).toBe(400);
    expect(await list(alice)).toHaveLength(1);
  });

  it("answers 401 to a visitor", async () => {
    server = await startTestServer();

    expect((await call("GET", "/blocks")).status).toBe(401);
    expect((await call("DELETE", "/blocks/00000000-0000-4000-9000-000000000000")).status).toBe(401);
  });
});

describe("rate limits on blocking (CC-044)", () => {
  it("answers 429 with the standard body and headers once a player blocks and unblocks too often", async () => {
    server = await startTestServer({ blockLimits: { perPlayer: { windowMs: 60_000, limit: 3 } } });
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, seats } = await finishedRace(alice, bob);
    const target = { roomCode: code, seat: seatOf(seats, bob) };

    const first = await block(alice, target);
    await call("DELETE", `/blocks/${first.body.block.blockId}`, { cookie: alice.cookie });
    await block(alice, target);
    const limited = await block(alice, target);
    const otherPlayer = await block(bob, { roomCode: code, seat: seatOf(seats, alice) });

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(limited.headers.get("ratelimit-policy")).toMatch(/^3;w=60/);
    expect(otherPlayer.status).toBe(200);
  });

  it("limits a network address too, so new guests buy no more", async () => {
    server = await startTestServer({ blockLimits: { perAddress: { windowMs: 60_000, limit: 2 } } });
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, seats } = await finishedRace(alice, bob);

    await block(alice, { roomCode: code, seat: seatOf(seats, bob) });
    await block(bob, { roomCode: code, seat: seatOf(seats, alice) });
    const limited = await block(alice, { roomCode: code, seat: seatOf(seats, bob) });

    expect(limited.status).toBe(429);
  });
});

describe("blocks follow a guest who signs in, and go with a deleted account (ADR-014, ADR-048)", () => {
  it("keeps a guest's block after sign-up, and a block on a guest after the guest signs up", async () => {
    server = await startTestServer();
    const [alice, bob, carol] = [await clients.player(), await clients.player(), await clients.player()];
    const { code, seats } = await finishedRace(alice, bob);
    await block(alice, { roomCode: code, seat: seatOf(seats, bob) });
    const other = await finishedRace(carol, alice);
    await block(alice, { roomCode: other.code, seat: seatOf(other.seats, carol) });

    const aliceAccount = await call("POST", "/auth/signup", {
      body: { username: "Alicia", email: "alicia@example.com", password: PASSWORD },
      cookie: alice.cookie,
    });
    const bobAccount = await call("POST", "/auth/signup", {
      body: { username: "Bobby", email: "bobby@example.com", password: PASSWORD },
      cookie: bob.cookie,
    });
    const aliceSocket = await clients.openSocket(aliceAccount.cookie);
    const bobSocket = await clients.openSocket(bobAccount.cookie);
    const fresh = await send(aliceSocket, SOCKET_EVENTS.ROOM_CREATE, { gameId: "race", options: {} });
    const refused = await send(bobSocket, SOCKET_EVENTS.ROOM_JOIN, { code: fresh.data.code });

    expect((await list({ cookie: aliceAccount.cookie })).map((each) => each.displayName).sort()).toEqual(
      [bob.identity.displayName, carol.identity.displayName].sort(),
    );
    expect(refused.error).toEqual({ code: ERROR_CODES.CONFLICT, message: "This room is full" });
  });

  it("exports the blocks an account made and erases every block on either side when it is deleted", async () => {
    server = await startTestServer();
    const account = await call("POST", "/auth/signup", {
      body: { username: "Riya", email: "riya@example.com", password: PASSWORD },
    });
    const riya = { cookie: account.cookie, identity: account.body.identity };
    riya.socket = await clients.openSocket(riya.cookie);
    const [bob, carol] = [await clients.player(), await clients.player()];
    const { code, seats } = await finishedRace(riya, bob);
    await block(riya, { roomCode: code, seat: seatOf(seats, bob) });
    const other = await finishedRace(carol, riya);
    await block(carol, { roomCode: other.code, seat: seatOf(other.seats, riya) });

    const exported = await call("POST", "/account/export", { body: { password: PASSWORD }, cookie: riya.cookie });
    const deleted = await call("POST", "/account/delete", { body: { password: PASSWORD }, cookie: riya.cookie });

    expect(exported.body.blocks).toEqual([
      { displayName: bob.identity.displayName, blockedAt: expect.any(String) },
    ]);
    expect(deleted.status).toBe(204);
    expect(await list(carol)).toEqual([]);
    expect([...(await server.blockComponent.blockedWith({ playerId: riya.identity.id }))]).toEqual([]);
  });
});
