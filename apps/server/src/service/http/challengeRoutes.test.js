import { afterEach, describe, expect, it } from "vitest";
import {
  CHALLENGE_LIMIT_REASONS,
  CHALLENGE_STATES,
  ERROR_CODES,
  PRESENCE,
  ROOM_STATUS,
  SOCKET_EVENTS,
} from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createSocketClients, eventWhere, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";
import { NotFoundError } from "../../utils/errors.js";

// CC-139, ADR-069: challenges over HTTP, with the pushes that tell both players on any page. No answer and no push
// carries a player id.
let server;
const clients = createSocketClients(() => server.baseUrl);
const DAY = 24 * 60 * 60 * 1000;
const UNKNOWN_ID = "0000000000000000zzzz";

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

/**
 * A clock tests can move. Each reading is a millisecond after the last, so challenges made one after another are in
 * the order they were made. The real clock gives two quick ones the same millisecond, and the same moment has no
 * order but the random ids (CC-336).
 */
function clock() {
  let at = Date.UTC(2026, 9, 20, 12);
  const now = () => at++;
  now.advance = (ms) => {
    at += ms;
  };
  return now;
}

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text === "" ? {} : JSON.parse(text) };
}

const make = (player, body = { gameId: "race", options: { target: 3 } }) =>
  call("POST", "/challenges", { body, cookie: player.cookie });
const view = (player, id) => call("GET", `/challenges/${id}`, { cookie: player?.cookie });
const answer = (player, id, what, body) =>
  call("POST", `/challenges/${id}/${what}`, { body, cookie: player.cookie });
const errorOf = (res) => ({
  status: res.status,
  code: res.body.error?.code,
  details: res.body.error?.details,
});

/** Waits until `test` holds, checking every few milliseconds. */
async function until(test) {
  for (let tries = 0; !(await test()); tries++) {
    if (tries > 200) throw new Error("never happened");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Every string anywhere in a value. */
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, each]) => [key, ...stringsIn(each)])
      : [];

describe("challenge routes (CC-139)", () => {
  it("lets anyone with the link see a challenge, and only a player make or answer one", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const { body } = await make(alice);

    const visitor = await view(undefined, body.challenge.id);

    expect(visitor.status).toBe(200);
    expect(visitor.headers.get("cache-control")).toBe("no-store");
    expect(visitor.body.challenge).toMatchObject({ state: CHALLENGE_STATES.OPEN, own: false, fromName: "" });
    expect((await call("POST", "/challenges", { body: { gameId: "race" } })).status).toBe(401);
    expect(await call("GET", "/challenges")).toMatchObject({ status: 200, body: { challenges: [] } });
    expect((await call("POST", `/challenges/${body.challenge.id}/accept`)).status).toBe(401);
  });

  it("answers one 404 for an unknown and a malformed id", async () => {
    server = await startTestServer();
    const alice = await clients.player();

    const unknown = await view(alice, UNKNOWN_ID);
    const malformed = await view(alice, "user_0123456789abcdef01234567");

    expect(errorOf(unknown)).toEqual(errorOf(malformed));
    expect(errorOf(unknown)).toMatchObject({ status: 404, code: ERROR_CODES.NOT_FOUND });
    expect((await answer(alice, "nope", "accept")).status).toBe(404);
  });

  it("makes a challenge with the game's options checked, and refuses anything else", async () => {
    server = await startTestServer();
    const alice = await clients.player();

    const made = await make(alice);
    expect(made.status).toBe(201);
    expect(made.body.challenge).toMatchObject({ gameId: "race", options: { target: 3 }, own: true });

    for (const body of [
      [],
      { gameId: "race", extra: 1 },
      { gameId: 7 },
      { gameId: "race", options: [] },
      { gameId: "race", options: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])) },
      { gameId: "race", to: "someone" },
      { gameId: "race", to: { handle: "user_0123456789abcdef01234567" } },
      { gameId: "race", to: { handle: "0123456789abcdef", more: 1 } },
      { gameId: "nope" },
    ]) {
      expect((await make(alice, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("names nobody by profile handle until CC-052, with the same 404 for every handle", async () => {
    server = await startTestServer();
    const alice = await clients.player();

    const res = await make(alice, {
      gameId: "race",
      options: { target: 3 },
      to: { handle: "0123456789abcdef" },
    });

    expect(errorOf(res)).toMatchObject({ status: 404, code: ERROR_CODES.NOT_FOUND });
  });

  it("refuses a fourth open challenge with the reason", async () => {
    server = await startTestServer({ now: clock() });
    const alice = await clients.player();
    await make(alice);
    await make(alice);
    await make(alice);

    expect(errorOf(await make(alice))).toEqual({
      status: 409,
      code: ERROR_CODES.CONFLICT,
      details: { reason: CHALLENGE_LIMIT_REASONS.OPEN, limit: 3 },
    });
  });

  it("limits how many challenges a player makes and answers", async () => {
    server = await startTestServer({
      challengeLimits: {
        createsPerPlayer: { windowMs: 60_000, limit: 1 },
        answersPerPlayer: { windowMs: 60_000, limit: 1 },
        lookupsPerPlayer: { windowMs: 60_000, limit: 1 },
      },
    });
    const alice = await clients.player();
    const { body } = await make(alice);

    expect((await make(alice)).status).toBe(429);
    expect((await answer(alice, body.challenge.id, "later")).status).toBe(200);
    expect((await answer(alice, body.challenge.id, "later")).status).toBe(429);
    expect((await view(alice, body.challenge.id)).status).toBe(200);
    expect((await view(alice, body.challenge.id)).status).toBe(429);
  });

  it("makes a room with both players when someone takes it, and the challenger hears it on any page", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    const { body } = await make(alice);
    const aliceHears = eventWhere(
      alice.socket,
      ({ challenge }) => challenge.state === CHALLENGE_STATES.ACCEPTED,
      SOCKET_EVENTS.CHALLENGE_UPDATED,
    );

    const taken = await answer(bob, body.challenge.id, "accept");

    expect(taken.status).toBe(200);
    expect(taken.body.room).toEqual({ code: expect.any(String), gameId: "race" });
    const { challenge } = await aliceHears;
    expect(challenge).toMatchObject({ acceptedName: bob.identity.displayName, room: taken.body.room });

    const bobIn = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: taken.body.room.code });
    expect(bobIn.data.status).toBe(ROOM_STATUS.WAITING);
    await until(
      async () => (await server.roomComponent.getRoom(taken.body.room.code)).seats[0].away === true,
    );
    expect(
      server.roomComponent.viewFor(await server.roomComponent.getRoom(taken.body.room.code), "").seats[0]
        .presence,
    ).toBe(PRESENCE.AWAY);
    const aliceIn = await send(alice.socket, SOCKET_EVENTS.ROOM_JOIN, { code: taken.body.room.code });
    expect(aliceIn.data.status).toBe(ROOM_STATUS.PLAYING);
  });

  it("answers 410 with the state for a challenge no longer open, and 403 to its own creator", async () => {
    const now = clock();
    server = await startTestServer({ now });
    const alice = await clients.player();
    const bob = await clients.player();
    const cara = await clients.player();
    const first = (await make(alice)).body.challenge;
    const second = (await make(alice)).body.challenge;

    expect(errorOf(await answer(alice, first.id, "accept")).status).toBe(403);
    await answer(bob, first.id, "accept");
    expect(errorOf(await answer(cara, first.id, "accept"))).toEqual({
      status: 410,
      code: ERROR_CODES.GONE,
      details: { state: CHALLENGE_STATES.ACCEPTED },
    });
    now.advance(DAY);
    expect(errorOf(await answer(cara, second.id, "accept")).details).toEqual({
      state: CHALLENGE_STATES.EXPIRED,
    });
    expect((await view(cara, second.id)).body.challenge.state).toBe(CHALLENGE_STATES.EXPIRED);
  });

  it("withdraws, moves to the inbox and lists the inbox, and refuses a body on an answer", async () => {
    server = await startTestServer({ now: clock() });
    const alice = await clients.player();
    const bob = await clients.player();
    const kept = (await make(alice)).body.challenge;
    const taken = (await make(alice)).body.challenge;

    expect((await answer(alice, kept.id, "later", {})).body.challenge.later).toBe(true);
    expect((await answer(alice, kept.id, "withdraw", { now: 1 })).status).toBe(400);
    expect((await answer(bob, kept.id, "decline")).status).toBe(403);
    expect(
      (await call("GET", "/challenges", { cookie: alice.cookie })).body.challenges.map((c) => c.id),
    ).toEqual([taken.id, kept.id]);
    expect((await answer(alice, kept.id, "withdraw")).body.challenge.state).toBe(CHALLENGE_STATES.WITHDRAWN);
  });

  it("shows a blocked player only what an expired challenge shows (ADR-053)", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const bob = await clients.player();
    const { code, seat } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
    const blocked = await call("POST", "/blocks", {
      body: { roomCode: code, seat: 0, seatId: seat.host },
      cookie: bob.cookie,
    });
    expect(blocked.status).toBe(200);
    const { challenge } = (await make(alice)).body;

    expect((await view(bob, challenge.id)).body.challenge).toMatchObject({ state: CHALLENGE_STATES.EXPIRED });
    expect(errorOf(await answer(bob, challenge.id, "accept"))).toEqual({
      status: 410,
      code: ERROR_CODES.GONE,
      details: { state: CHALLENGE_STATES.EXPIRED },
    });
  });

  it("sends no player id in any answer or push, a challenge to one person included", async () => {
    server = await startTestServer({
      challengeRecipients: {
        resolve: async ({ target }) => {
          const person = [bob, cara].find((each) => each?.handle === target.handle);
          if (person === undefined) throw new NotFoundError("We couldn't find that player");
          return person.identity;
        },
      },
    });
    const alice = await clients.player();
    const bob = { ...(await clients.player()), handle: "bbbbbbbbbbbbbbbb" };
    const cara = { ...(await clients.player()), handle: "cccccccccccccccc" };
    const answers = [];
    const keep = async (res) => {
      answers.push(res.body);
      return res.body;
    };

    const link = (await keep(await make(alice))).challenge;
    const toBob = (
      await keep(await make(alice, { gameId: "race", options: { target: 3 }, to: { handle: bob.handle } }))
    ).challenge;
    const toCara = (
      await keep(await make(alice, { gameId: "race", options: { target: 3 }, to: { handle: cara.handle } }))
    ).challenge;
    await keep(await view(bob, toBob.id));
    await keep(await answer(bob, toBob.id, "later"));
    await keep(await answer(cara, toCara.id, "decline"));
    await keep(await answer(bob, link.id, "accept"));
    await keep(await answer(bob, toBob.id, "accept"));
    for (const player of [alice, bob, cara]) {
      await keep(await call("GET", "/challenges", { cookie: player.cookie }));
      await keep(await view(player, link.id));
    }
    await until(() =>
      alice.received.some(
        ({ event, payload }) =>
          event === SOCKET_EVENTS.CHALLENGE_UPDATED &&
          payload.challenge.id === toBob.id &&
          payload.challenge.state === CHALLENGE_STATES.ACCEPTED,
      ),
    );

    const pushes = [alice, bob, cara].flatMap((player) =>
      player.received.filter(({ event }) => event === SOCKET_EVENTS.CHALLENGE_UPDATED),
    );
    expect(pushes.length).toBeGreaterThanOrEqual(8);
    expect(stringsIn([answers, pushes]).filter(hasPlayerIdShape)).toEqual([]);
  });
});
