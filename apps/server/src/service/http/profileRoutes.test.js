import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// CC-034, ADR-065: profiles and avatars over HTTP. A profile is reached by its random handle only, an adult's only
// when they made it public, and nobody else is ever shown but as "Hidden player".
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const PASSWORD = "correct horse battery";
const THIS_YEAR = new Date().getFullYear();
const ADULT_YEAR = 1990;
const MINOR_YEAR = THIS_YEAR - 15;

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

/** A guest with a socket, as a browser has. */
const guest = () => clients.player();

/** A guest who signs up with a year of birth, or without one when `birthYear` is undefined. */
async function account(username, birthYear) {
  const player = await guest();
  const res = await call("POST", "/auth/signup", {
    body: {
      username,
      email: `${username.toLowerCase()}@example.com`,
      password: PASSWORD,
      ...(birthYear !== undefined && { birthYear }),
    },
    cookie: player.cookie,
  });
  expect(res.status).toBe(201);
  const socket = await clients.openSocket(res.cookie);
  return { ...player, cookie: res.cookie, identity: res.body.identity, socket };
}

const own = async (player) => (await call("GET", "/profile", { cookie: player.cookie })).body.profile;
const lookUp = (handle, player) => call("GET", `/profiles/${handle}`, { cookie: player?.cookie });
const setAvatar = (player, avatar) =>
  call("PUT", "/profile/avatar", { body: { avatar }, cookie: player.cookie });
const setVisibility = (player, visibility) =>
  call("PUT", "/profile/visibility", { body: { visibility }, cookie: player.cookie });
const withoutRequestId = (body) => ({ ...body, error: { ...body.error, requestId: "-" } });

/** Every string anywhere in a value. */
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? [...Object.keys(value), ...Object.values(value)].flatMap(stringsIn)
      : [];

/** Alice hosts a race, Bob joins and moves first (seed 42), Alice wins, and the match pipeline has run. */
async function race(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  const ended = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await server.tasks.drain();
  return { code, room: ended.data };
}

describe("your own profile (CC-034)", () => {
  it("asks a visitor to start a session first", async () => {
    server = await startTestServer();

    const res = await call("GET", "/profile");

    expect(res.status).toBe(401);
  });

  it("gives a guest a handle, private, that they cannot make public, and never stores the answer", async () => {
    server = await startTestServer();
    const player = await guest();

    const res = await call("GET", "/profile", { cookie: player.cookie });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body.profile).toEqual({
      handle: expect.stringMatching(/^[0-9a-hjkmnp-tv-z]{16}$/),
      visibility: "private",
      canBePublic: false,
    });
    expect(await own(player)).toEqual(res.body.profile);
  });

  it("lets a guest pick an avatar, and refuses anything else", async () => {
    server = await startTestServer();
    const player = await guest();

    const picked = await setAvatar(player, "rocket");
    const unknown = await setAvatar(player, "photo.jpg");
    const extra = await call("PUT", "/profile/avatar", {
      body: { avatar: "owl", url: "https://example.com/me.png" },
      cookie: player.cookie,
    });
    const notObject = await call("PUT", "/profile/avatar", { body: ["owl"], cookie: player.cookie });

    expect(picked.status).toBe(200);
    expect(picked.body.profile.avatar).toBe("rocket");
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details).toEqual({ field: "avatar" });
    expect(extra.status).toBe(400);
    expect(extra.body.error.details).toEqual({ fields: ["url"] });
    expect(notObject.status).toBe(400);
    expect((await own(player)).avatar).toBe("rocket");
  });

  it("lets only an adult account make the profile public, and anyone make it private", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);
    const kabir = await account("KabirTest", MINOR_YEAR);
    const meena = await account("MeenaTest", undefined);
    const visitorGuest = await guest();

    expect((await own(riya)).canBePublic).toBe(true);
    expect((await setVisibility(riya, "public")).body.profile.visibility).toBe("public");
    for (const player of [kabir, meena, visitorGuest]) {
      const refused = await setVisibility(player, "public");
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
      expect((await setVisibility(player, "private")).status).toBe(200);
    }
    expect((await setVisibility(riya, "everyone")).status).toBe(400);
  });

  it("logs a visibility change by player id only", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);

    await setVisibility(riya, "public");

    const [line] = server.find("profile visibility changed");
    expect(line).toMatchObject({ playerId: riya.identity.id, visibility: "public" });
  });
});

describe("a profile by its handle (CC-034)", () => {
  it("shows an adult's public profile to a visitor, and the same to anyone else", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);
    await setAvatar(riya, "crown");
    await setVisibility(riya, "public");
    const { handle } = await own(riya);

    const visitor = await lookUp(handle);
    const other = await lookUp(handle, await guest());

    expect(visitor.status).toBe(200);
    expect(visitor.headers.get("cache-control")).toBe("no-store");
    expect(visitor.body.player).toEqual({
      handle,
      displayName: "RiyaTest",
      avatar: "crown",
      level: 1,
      stats: { gamesPlayed: 0, wins: 0 },
      chess: { rating: 1500, provisional: true, games: 0 },
    });
    expect(other.body).toEqual(visitor.body);
  });

  it("shows only the name and avatar of an adult who has not made it public", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);
    await setAvatar(riya, "crown");

    const res = await lookUp((await own(riya)).handle);

    expect(res.body.player).toEqual({
      handle: expect.any(String),
      displayName: "RiyaTest",
      avatar: "crown",
      private: true,
    });
  });

  it("shows a minor, an account of unknown age and a guest as Hidden player, nothing more", async () => {
    server = await startTestServer();
    const players = [
      await account("KabirTest", MINOR_YEAR),
      await account("MeenaTest", undefined),
      await guest(),
    ];

    for (const player of players) {
      await setAvatar(player, "fox");
      const { handle } = await own(player);
      expect((await lookUp(handle)).body.player).toEqual({
        handle,
        hidden: true,
        displayName: "Hidden player",
      });
    }
  });

  it("marks a player's own profile as theirs", async () => {
    server = await startTestServer();
    const kabir = await account("KabirTest", MINOR_YEAR);
    const { handle } = await own(kabir);

    expect((await lookUp(handle, kabir)).body.player).toEqual({
      handle,
      own: true,
      hidden: true,
      displayName: "Hidden player",
    });
  });

  it("answers exactly the same 404 for a handle nobody has, a malformed one and a blocked pair, both ways", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);
    const arjun = await account("ArjunTest", ADULT_YEAR);
    await setVisibility(riya, "public");
    await setVisibility(arjun, "public");
    const { code } = await race(riya, arjun);
    const blocked = await call("POST", "/blocks", {
      body: {
        roomCode: code,
        seat: 1,
        seatId: (await send(riya.socket, SOCKET_EVENTS.ROOM_JOIN, { code })).data.seats[1].playerId,
      },
      cookie: riya.cookie,
    });
    expect(blocked.status).toBe(200);

    const answers = [
      await lookUp("0000000000000000"),
      await lookUp("not-a-handle"),
      await lookUp(riya.identity.id),
      await lookUp((await own(arjun)).handle, riya),
      await lookUp((await own(riya)).handle, arjun),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(withoutRequestId(answer.body)).toEqual({
        error: { code: ERROR_CODES.NOT_FOUND, message: "No such player", requestId: "-" },
      });
    }
    expect((await lookUp((await own(arjun)).handle)).status).toBe(200);
  });

  it("finds nothing at a deleted account's handle", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);
    const { handle } = await own(riya);

    expect(
      (await call("POST", "/account/delete", { body: { password: PASSWORD }, cookie: riya.cookie })).status,
    ).toBe(204);

    expect((await lookUp(handle)).status).toBe(404);
  });

  it("limits how many profiles one network and one player may open", async () => {
    server = await startTestServer({
      profileLimits: {
        lookupsPerAddress: { windowMs: 60_000, limit: 3 },
        lookupsPerPlayer: { windowMs: 60_000, limit: 2 },
      },
    });
    const player = await guest();
    const { handle } = await own(player);

    const byPlayer = [
      await lookUp(handle, player),
      await lookUp(handle, player),
      await lookUp(handle, player),
    ];
    const byAddress = [await lookUp(handle), await lookUp(handle), await lookUp(handle)];

    expect(byPlayer.map((res) => res.status)).toEqual([200, 200, 429]);
    // The address counted the player's two lookups it let through, not the one the player's own limit refused.
    expect(byAddress.map((res) => res.status)).toEqual([200, 429, 429]);
    expect(byAddress[2].body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it("limits how often a player changes their profile", async () => {
    server = await startTestServer({ profileLimits: { changesPerPlayer: { windowMs: 60_000, limit: 2 } } });
    const player = await guest();

    const statuses = [];
    for (const avatar of ["owl", "fox", "cat"]) statuses.push((await setAvatar(player, avatar)).status);

    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe("avatars and links where players meet (CC-034)", () => {
  it("shows each player's avatar on their seat to everyone in the room", async () => {
    server = await startTestServer();
    const alice = await guest();
    const bob = await guest();
    await setAvatar(alice, "rocket");
    await setAvatar(bob, "owl");

    const { joined } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });

    expect(joined.data.seats.map((seat) => seat.avatar)).toEqual(["rocket", "owl"]);
  });

  it("links an adult's board row and history entry to their profile, and nobody else's", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);
    const kabir = await account("KabirTest", MINOR_YEAR);
    await setAvatar(riya, "crown");
    await setAvatar(kabir, "fox");
    const { handle } = await own(riya);
    await race(riya, kabir);

    const board = (await call("GET", "/leaderboards/overall")).body.entries;
    const history = (await call("GET", "/matches", { cookie: kabir.cookie })).body.matches[0];

    expect(board).toEqual([
      expect.objectContaining({ displayName: "RiyaTest", avatar: "crown", profile: handle }),
      { rank: 2, displayName: "Hidden player", hidden: true, level: 1, score: expect.any(Number) },
    ]);
    expect(history.players).toEqual([
      expect.objectContaining({ displayName: "RiyaTest", avatar: "crown", profile: handle }),
      expect.not.objectContaining({ profile: expect.anything() }),
    ]);
  });

  it("moves a guest's avatar to the account they sign up for", async () => {
    server = await startTestServer();
    const player = await guest();
    await setAvatar(player, "comet");
    const { handle } = await own(player);

    const signedUp = await call("POST", "/auth/signup", {
      body: { username: "SamTest", email: "sam@example.com", password: PASSWORD },
      cookie: player.cookie,
    });

    expect(await own({ cookie: signedUp.cookie })).toMatchObject({ handle, avatar: "comet" });
  });

  it("puts the profile in the export, and no player id anywhere a profile, board or history answers", async () => {
    server = await startTestServer();
    const riya = await account("RiyaTest", ADULT_YEAR);
    const sam = await guest();
    await setAvatar(riya, "crown");
    await setVisibility(riya, "public");
    await race(riya, sam);
    const handles = [(await own(riya)).handle, (await own(sam)).handle];

    const exported = await call("POST", "/account/export", {
      body: { password: PASSWORD },
      cookie: riya.cookie,
    });
    const answers = [
      exported.body.profiles,
      await own(riya),
      await own(sam),
      ...(await Promise.all(handles.map(async (handle) => (await lookUp(handle, sam)).body))),
      (await call("GET", "/leaderboards/overall", { cookie: sam.cookie })).body,
      (await call("GET", "/matches", { cookie: sam.cookie })).body,
      (await call("GET", "/matches", { cookie: riya.cookie })).body,
    ];

    expect(exported.body.profiles).toEqual({ handle: handles[0], avatar: "crown", visibility: "public" });
    const ownIds = new Set([riya.identity.id, sam.identity.id]);
    expect(stringsIn(answers.slice(1)).filter(hasPlayerIdShape)).toEqual([]);
    expect(stringsIn(exported.body.profiles).filter((s) => ownIds.has(s))).toEqual([]);
  });
});
