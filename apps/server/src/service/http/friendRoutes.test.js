import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, FRIEND_LINK_MAKER_NAME, SOCKET_EVENTS } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createSocketClients, eventWhere, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";
import { FRIEND_ROUTE_LIMITS } from "./friendRoutes.js";

// CC-052, ADR-066: friends over HTTP and their pushes. Two accounts who played together become friends, see each
// other's presence and nobody else's, and every "no" (a decline, a block) looks like nothing at all.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const PASSWORD = "correct horse battery";
const ADULT_YEAR = 1990;
const MINOR_YEAR = new Date().getFullYear() - 15;

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text === "" ? {} : JSON.parse(text) };
}

/** A guest with a socket, as a browser has. */
const guest = () => clients.player();

/** A guest who signs up, with a socket on the account's session that logs every push. */
async function account(username, birthYear = ADULT_YEAR) {
  const player = await guest();
  const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: player.cookie },
    body: JSON.stringify({
      username,
      email: `${username.toLowerCase()}@example.com`,
      password: PASSWORD,
      birthYear,
    }),
  });
  expect(signup.status).toBe(201);
  const cookie = signup.headers.get("set-cookie").split(";")[0];
  const received = [];
  const socket = await clients.openSocket(cookie, {
    listen: (s) => s.onAny((event, payload) => received.push({ event, payload })),
  });
  return { cookie, socket, received };
}

/** Every string anywhere in a value. */
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? [...Object.keys(value), ...Object.values(value)].flatMap(stringsIn)
      : [];

const view = async (player) => (await call("GET", "/friends", { cookie: player.cookie })).body;
const pushes = (player, event) =>
  player.received.filter((entry) => entry.event === event).map((entry) => entry.payload);

/** Alice hosts a race, Bob joins. Answers how each names the other: their seat in the room. */
async function together(alice, bob) {
  const { code, joined } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  const seats = joined.data.seats;
  const seatOf = (seatId) => ({
    roomCode: code,
    seat: seats.findIndex((s) => s.playerId === seatId),
    seatId,
  });
  return { code, bobSeat: seatOf(joined.data.you), aliceSeat: seatOf(joined.data.hostId) };
}

const ask = (player, target) => call("POST", "/friends/requests", { body: target, cookie: player.cookie });
const answer = (player, requestId, reply) =>
  call("POST", `/friends/requests/${requestId}/answer`, { body: { answer: reply }, cookie: player.cookie });

/** Riya and Arjun, adults who played together and are friends now. */
async function friends() {
  const riya = await account("RiyaTest");
  const arjun = await account("ArjunTest");
  const { bobSeat, aliceSeat, code } = await together(riya, arjun);
  expect((await ask(riya, bobSeat)).body).toEqual({ result: "sent" });
  expect((await ask(arjun, aliceSeat)).body).toEqual({ result: "friends" });
  return { riya, arjun, code };
}

describe("who can use friends (CC-052)", () => {
  it("asks a visitor to start a session, and tells a guest to save their progress", async () => {
    server = await startTestServer();
    const player = await guest();

    const visitor = await call("GET", "/friends");
    const asGuest = await call("GET", "/friends", { cookie: player.cookie });

    expect(visitor.status).toBe(401);
    expect(asGuest.status).toBe(403);
    expect(asGuest.body.error).toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      message: "Save your progress to add friends",
    });
  });

  it("refuses to befriend a guest one played with, and says why", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest");
    const bob = await guest();
    const { bobSeat } = await together(riya, bob);

    const res = await ask(riya, bobSeat);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/needs to save their progress/);
  });
});

describe("asking, answering and the pushes (CC-052)", () => {
  it("sends a request from the room, which the other player hears about on any page and accepts", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest");
    const arjun = await account("ArjunTest");
    const { bobSeat } = await together(riya, arjun);
    const toasted = eventWhere(arjun.socket, () => true, SOCKET_EVENTS.FRIEND_REQUESTED);

    const sent = await ask(riya, bobSeat);

    expect(sent.status).toBe(200);
    expect(sent.headers.get("cache-control")).toBe("no-store");
    expect(sent.body).toEqual({ result: "sent" });
    expect(await toasted).toEqual({ requestId: expect.any(String), displayName: "RiyaTest", via: "game" });
    const [request] = (await view(arjun)).incoming;
    expect(request).toEqual({
      requestId: expect.any(String),
      displayName: "RiyaTest",
      via: "game",
      sentAt: expect.any(Number),
    });
    const riyaHears = eventWhere(riya.socket, (v) => v.friends.length === 1, SOCKET_EVENTS.FRIENDS_UPDATED);

    const accepted = await answer(arjun, request.requestId, "accept");

    expect(accepted.body).toEqual({ result: "friends" });
    expect((await riyaHears).friends).toEqual([
      expect.objectContaining({
        displayName: "ArjunTest",
        presence: "playing",
        handle: expect.stringMatching(/^[0-9a-hjkmnp-tv-z]{16}$/),
      }),
    ]);
  });

  it("sends a request from match history, by match and seat", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest");
    const arjun = await account("ArjunTest");
    const { code } = await together(riya, arjun);
    // Arjun moves first with seed 42, and the race to 3 ends on Riya's move.
    await send(arjun.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
    const ended = await send(riya.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
    await server.tasks.drain();
    const { body } = await call("GET", `/matches/${ended.data.game.matchId}`, { cookie: riya.cookie });
    const seat = body.match.players.findIndex((p) => p.playerId !== body.match.you);

    const res = await ask(riya, { matchId: body.match.matchId, seat });

    expect(res.body).toEqual({ result: "sent" });
    expect((await view(arjun)).incoming.map((r) => r.displayName)).toEqual(["RiyaTest"]);
  });

  it("declines quietly: nothing reaches the sender, whose view stays as it was", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest");
    const arjun = await account("ArjunTest");
    const { bobSeat } = await together(riya, arjun);
    await ask(riya, bobSeat);
    const before = await view(riya);
    const [request] = (await view(arjun)).incoming;
    const arjunHears = eventWhere(
      arjun.socket,
      (v) => v.incoming.length === 0,
      SOCKET_EVENTS.FRIENDS_UPDATED,
    );
    const pushedToRiya = pushes(riya, SOCKET_EVENTS.FRIENDS_UPDATED).length;

    const declined = await answer(arjun, request.requestId, "decline");
    await arjunHears;

    expect(declined.body).toEqual({ result: "declined" });
    expect(await view(riya)).toEqual(before);
    expect(pushes(riya, SOCKET_EVENTS.FRIENDS_UPDATED)).toHaveLength(pushedToRiya);
  });

  it("refuses a malformed request, answer, request id, handle or token", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest");

    const results = [
      await ask(riya, { roomCode: "ROOM22", seat: 0, seatId: "user_aaaaaaaaaaaaaaaaaaaaaaaa" }),
      await ask(riya, { playerId: "user_aaaaaaaaaaaaaaaaaaaaaaaa" }),
      await call("POST", "/friends/requests/00000000-0000-4000-9000-000000000001/answer", {
        body: { answer: "accept", extra: 1 },
        cookie: riya.cookie,
      }),
      await answer(riya, "00000000-0000-4000-9000-000000000001", "maybe"),
      await call("POST", "/friends/requests/not-an-id/answer", {
        body: { answer: "accept" },
        cookie: riya.cookie,
      }),
      await call("DELETE", "/friends/requests/not-an-id", { cookie: riya.cookie }),
      await call("DELETE", "/friends/user_aaaaaaaaaaaaaaaaaaaaaaaa", { cookie: riya.cookie }),
      await call("GET", "/friends/links/short"),
      await call("POST", "/friends/links/short", { cookie: riya.cookie }),
      await call("PUT", "/friends/settings", { body: "yes", cookie: riya.cookie }),
    ];

    expect(results.map((res) => res.status)).toEqual([400, 400, 400, 400, 404, 404, 404, 404, 404, 400]);
  });
});

describe("removing, appear offline and presence (CC-052)", () => {
  it("shows friends' presence live: playing while a game is on, online after, offline when the tab goes", async () => {
    server = await startTestServer();
    const { riya, arjun, code } = await friends();
    expect((await view(riya)).friends[0].presence).toBe("playing");
    const online = eventWhere(
      riya.socket,
      (p) => p.presence === "online",
      SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED,
    );

    await send(arjun.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
    await send(riya.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });

    expect(await online).toEqual({ handle: (await view(riya)).friends[0].handle, presence: "online" });
    const offline = eventWhere(
      riya.socket,
      (p) => p.presence === "offline",
      SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED,
    );
    arjun.socket.disconnect();
    await offline;
    expect((await view(riya)).friends[0].presence).toBe("offline");
  });

  it("shows a player who appears offline as offline to friends at once, and refuses anything but true or false", async () => {
    server = await startTestServer();
    const { riya, arjun } = await friends();
    const offline = eventWhere(
      riya.socket,
      (p) => p.presence === "offline",
      SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED,
    );

    const res = await call("PUT", "/friends/settings", {
      body: { appearOffline: true },
      cookie: arjun.cookie,
    });
    const wrong = await call("PUT", "/friends/settings", {
      body: { appearOffline: "yes" },
      cookie: arjun.cookie,
    });

    expect(res.body).toEqual({ settings: { appearOffline: true } });
    await offline;
    expect((await view(riya)).friends[0].presence).toBe("offline");
    expect((await view(arjun)).settings).toEqual({ appearOffline: true });
    expect(wrong.status).toBe(400);
  });

  it("removes a friend for both, quietly, and a handle that is not a friend gets 404", async () => {
    server = await startTestServer();
    const { riya, arjun } = await friends();
    const { handle } = (await view(riya)).friends[0];

    const removed = await call("DELETE", `/friends/${handle}`, { cookie: riya.cookie });
    const again = await call("DELETE", `/friends/${handle}`, { cookie: riya.cookie });

    expect(removed.status).toBe(204);
    expect(again.status).toBe(404);
    expect((await view(arjun)).friends).toEqual([]);
  });

  it("ends the friendship both ways when one blocks the other, and a request into the block still says sent", async () => {
    server = await startTestServer();
    const { riya, arjun, code } = await friends();
    const room = (await send(riya.socket, SOCKET_EVENTS.ROOM_JOIN, { code })).data;
    const arjunSeat = room.seats.findIndex((s) => s.playerId !== room.you);

    const blocked = await call("POST", "/blocks", {
      body: { roomCode: code, seat: arjunSeat, seatId: room.seats[arjunSeat].playerId },
      cookie: riya.cookie,
    });

    expect(blocked.status).toBe(200);
    expect((await view(riya)).friends).toEqual([]);
    expect((await view(arjun)).friends).toEqual([]);
    const arjunsView = (await send(arjun.socket, SOCKET_EVENTS.ROOM_JOIN, { code })).data;
    const riyaSeat = arjunsView.seats.findIndex((s) => s.playerId !== arjunsView.you);
    const asked = await ask(arjun, {
      roomCode: code,
      seat: riyaSeat,
      seatId: arjunsView.seats[riyaSeat].playerId,
    });
    expect(asked.body).toEqual({ result: "sent" });
    expect((await view(riya)).incoming).toEqual([]);
    expect(stringsIn(arjun.received).join(" ")).not.toMatch(/block/i);
  });
});

describe("friend links (ADR-066.3)", () => {
  it("makes a link anyone holding it can open, a guest is told to save progress, and one account uses it once", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest");
    const arjun = await account("ArjunTest");
    const meena = await account("MeenaTest");
    const visitorGuest = await guest();

    const made = await call("POST", "/friends/links", { cookie: riya.cookie });
    const { token } = made.body.link;
    const page = await call("GET", `/friends/links/${token}`);
    const own = await call("GET", `/friends/links/${token}`, { cookie: riya.cookie });
    const byGuest = await call("POST", `/friends/links/${token}`, { cookie: visitorGuest.cookie });
    const used = await call("POST", `/friends/links/${token}`, { cookie: arjun.cookie });
    const usedAgain = await call("POST", `/friends/links/${token}`, { cookie: meena.cookie });

    expect(made.body.link).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      expiresAt: expect.any(Number),
    });
    expect(page.body).toEqual({ invite: { displayName: "RiyaTest" } });
    expect(own.body).toEqual({ invite: { displayName: "RiyaTest", own: true } });
    expect(byGuest.status).toBe(403);
    expect(used.body).toEqual({ result: "sent" });
    expect(usedAgain.status).toBe(404);
    expect((await call("GET", `/friends/links/${token}`)).status).toBe(404);
    expect((await view(riya)).incoming).toEqual([
      expect.objectContaining({ displayName: "ArjunTest", via: "link" }),
    ]);
  });

  it("never names a maker who is not surely an adult to whoever holds their link", async () => {
    server = await startTestServer();
    const kabir = await account("KabirTest", MINOR_YEAR);
    const arjun = await account("ArjunTest");
    const { token } = (await call("POST", "/friends/links", { cookie: kabir.cookie })).body.link;

    const page = await call("GET", `/friends/links/${token}`, { cookie: arjun.cookie });
    await call("POST", `/friends/links/${token}`, { cookie: arjun.cookie });

    expect(page.body.invite).toEqual({ displayName: FRIEND_LINK_MAKER_NAME });
    expect((await view(arjun)).outgoing.map((r) => r.displayName)).toEqual([FRIEND_LINK_MAKER_NAME]);
    expect((await view(kabir)).safetyTips).toBe(true);
  });
});

describe("limits, deletion and ids (CC-052)", () => {
  it("gives a network more than one player, counting only what the player's own limit let through", async () => {
    expect(FRIEND_ROUTE_LIMITS.sendsPerAddress.limit).toBe(5 * FRIEND_ROUTE_LIMITS.sendsPerPlayer.limit);
    expect(FRIEND_ROUTE_LIMITS.changesPerAddress.limit).toBe(5 * FRIEND_ROUTE_LIMITS.changesPerPlayer.limit);
    expect(FRIEND_ROUTE_LIMITS.lookupsPerAddress.limit).toBe(5 * FRIEND_ROUTE_LIMITS.lookupsPerPlayer.limit);
    server = await startTestServer({
      friendLimits: {
        sendsPerPlayer: { windowMs: 60_000, limit: 1 },
        sendsPerAddress: { windowMs: 60_000, limit: 2 },
        lookupsPerPlayer: { windowMs: 60_000, limit: 1 },
        lookupsPerAddress: { windowMs: 60_000, limit: 2 },
      },
    });
    const riya = await account("RiyaTest");
    const arjun = await account("ArjunTest");
    const { bobSeat, aliceSeat } = await together(riya, arjun);
    const link = (await call("POST", "/friends/links", { cookie: riya.cookie })).body.link;

    const riyas = [await ask(riya, bobSeat), await ask(riya, bobSeat)];
    const arjuns = [await ask(arjun, aliceSeat), await ask(arjun, aliceSeat)];
    const lookups = [
      await call("GET", `/friends/links/${link.token}`, { cookie: arjun.cookie }),
      await call("GET", `/friends/links/${link.token}`, { cookie: arjun.cookie }),
      await call("GET", `/friends/links/${link.token}`),
      await call("GET", `/friends/links/${link.token}`),
    ];

    expect(riyas.map((res) => res.status)).toEqual([200, 429]);
    expect(arjuns.map((res) => res.status)).toEqual([200, 429]);
    expect(arjuns[1].body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(lookups.map((res) => res.status)).toEqual([200, 429, 200, 429]);
  });

  it("limits answers, cancels, removals, the switch and new links together", async () => {
    server = await startTestServer({ friendLimits: { changesPerPlayer: { windowMs: 60_000, limit: 2 } } });
    const riya = await account("RiyaTest");

    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await call("POST", "/friends/links", { cookie: riya.cookie })).status);

    expect(statuses).toEqual([200, 200, 429]);
  });

  it("exports a player's friends, and deleting the account removes them from their friends' lists", async () => {
    server = await startTestServer();
    const { riya, arjun } = await friends();

    const exported = await call("POST", "/account/export", {
      body: { password: PASSWORD },
      cookie: riya.cookie,
    });
    const arjunHears = eventWhere(arjun.socket, (v) => v.friends.length === 0, SOCKET_EVENTS.FRIENDS_UPDATED);
    const deleted = await call("POST", "/account/delete", {
      body: { password: PASSWORD },
      cookie: riya.cookie,
    });

    expect(exported.body.friends).toEqual({
      friends: [{ displayName: "ArjunTest", since: expect.any(String) }],
      requestsSent: [],
      friendLinks: [],
      appearOffline: false,
    });
    expect(deleted.status).toBe(204);
    await arjunHears;
    expect((await view(arjun)).friends).toEqual([]);
  });

  it("never sends a client anything shaped like a player id, in any answer or push", async () => {
    server = await startTestServer();
    const { riya, arjun } = await friends();
    const { token } = (await call("POST", "/friends/links", { cookie: arjun.cookie })).body.link;
    const offline = eventWhere(
      arjun.socket,
      (p) => p.presence === "offline",
      SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED,
    );
    const answers = [
      await view(riya),
      await view(arjun),
      (await call("GET", `/friends/links/${token}`)).body,
      (await call("PUT", "/friends/settings", { body: { appearOffline: true }, cookie: riya.cookie })).body,
    ];
    await offline;

    const friendsPushes = [riya, arjun].flatMap((player) =>
      player.received.filter((entry) => entry.event.startsWith("friends:")),
    );
    expect(friendsPushes.length).toBeGreaterThan(0);
    expect(stringsIn([answers, friendsPushes]).filter(hasPlayerIdShape)).toEqual([]);
  });
});
