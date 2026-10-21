import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS, SUSPENSION_DURATIONS } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { createInMemorySuspensionDao } from "../../testing/inMemorySuspensionDao.js";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";
import { createPasswordHasher } from "../../utils/passwordHasher.js";

// CC-334, ADR-078: the owner suspends a reported account from the report console. Its sessions end and its sockets
// are cut at once, sign-in is refused with the end date only after the right password, its export still works,
// and no answer anywhere carries a player id, tells a reporter the outcome or names a reporter.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const PASSWORD = "correct horse battery";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ADULT_YEAR = 1990;

/** A clock the tests move, so a suspension can end without waiting. */
function movableClock() {
  let offset = 0;
  return { now: () => Date.now() + offset, advance: (ms) => (offset += ms) };
}

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

/** Every string anywhere in a value, keys too. */
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? [...Object.keys(value), ...Object.values(value)].flatMap(stringsIn)
      : [];

/** The owner's account made before the server starts, so ADMIN_ACCOUNT_IDS can name it, as on Render. */
async function withOwner(extra = {}) {
  const accountDao = createInMemoryAccountDao();
  const { accountId } = await accountDao.insert({
    username: "Owner",
    email: "owner@example.com",
    passwordHash: await createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }).hash(PASSWORD),
    createdAt: new Date(),
    birthYear: ADULT_YEAR,
  });
  return { accountDao, env: { ADMIN_ACCOUNT_IDS: `user_${accountId}` }, ...extra };
}

const logIn = (email, password = PASSWORD) => call("POST", "/auth/login", { body: { email, password } });

/** A guest who signs up, with a socket on the account's session that logs every push. */
async function account(username) {
  const player = await clients.player();
  const email = `${username.toLowerCase()}@example.com`;
  const signup = await call("POST", "/auth/signup", {
    body: { username, email, password: PASSWORD, birthYear: ADULT_YEAR },
    cookie: player.cookie,
  });
  expect(signup.status).toBe(201);
  const received = [];
  const socket = await clients.openSocket(signup.cookie, {
    listen: (s) => s.onAny((event, payload) => received.push({ event, payload })),
  });
  return { cookie: signup.cookie, socket, received, email, identity: signup.body.identity };
}

/** `reporter` hosts a race, `reported` joins, and the reporter reports them from their seat. */
async function reported(reporter, target) {
  const { code, joined } = await startRoom(reporter, target, { gameId: "race", options: { target: 3 } });
  const seat = joined.data.seats.findIndex((s) => s.playerId === joined.data.you);
  const res = await call("POST", "/reports", {
    body: { roomCode: code, seat, seatId: joined.data.you, reason: "harassment" },
    cookie: reporter.cookie,
  });
  expect(res.status).toBe(200);
  return { code, reportId: res.body.report.reportId };
}

const suspend = (owner, reportId, body) =>
  call("POST", `/admin/reports/${reportId}/suspension`, { body, cookie: owner.cookie });
const lift = (owner, suspensionId) =>
  call("POST", `/admin/suspensions/${suspensionId}/lift`, { cookie: owner.cookie });

/** Waits for a condition the server reaches on its own, such as a socket's disconnect being seen. */
async function eventually(check) {
  for (let tries = 0; tries < 50; tries += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the condition was never met");
}

describe("POST /api/admin/reports/:reportId/suspension (CC-334, AC-1)", () => {
  it("suspends the account of a report for each duration with a closed reason, and closes its open reports", async () => {
    const suspensionDao = createInMemorySuspensionDao();
    const clock = movableClock();
    server = await startTestServer(await withOwner({ suspensionDao, now: clock.now }));
    const alice = await clients.player();
    const bob = await account("BobTest");
    const { reportId } = await reported(alice, bob);
    const owner = await logIn("owner@example.com");
    const ownerId = owner.body.identity.id;

    const answers = [];
    for (const duration of SUSPENSION_DURATIONS) {
      const at = clock.now();
      const res = await suspend(owner, reportId, { duration, reason: "harassment" });
      expect(res.status).toBe(200);
      answers.push({ duration, at, res });
      const stored = await suspensionDao.getById(res.body.suspension.suspensionId);
      expect(stored).toMatchObject({ playerId: bob.identity.id, byId: ownerId, byName: "Owner", duration });
      expect(await lift(owner, res.body.suspension.suspensionId)).toMatchObject({ status: 200 });
    }

    const lengths = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS };
    for (const { duration, at, res } of answers) {
      const { suspension } = res.body;
      expect(suspension).toMatchObject({
        duration,
        reason: "harassment",
        nameThen: "BobTest",
        byName: "Owner",
      });
      expect(suspension.startedAt).toBeGreaterThanOrEqual(at);
      if (duration === "until-lifted") expect(suspension).not.toHaveProperty("endsAt");
      else expect(suspension.endsAt - suspension.startedAt).toBe(lengths[duration]);
    }
    // The first suspension closed the group's open report as acted on; the later ones had none left to close.
    expect(answers.map(({ res }) => res.body.closed)).toEqual([1, 0, 0, 0]);
    const actioned = await call("GET", "/admin/reports?status=actioned", { cookie: owner.cookie });
    expect(actioned.body.groups[0].items[0]).toMatchObject({ action: "suspend" });
  });

  it("refuses another duration, a free text reason, a guest, an admin account and a second suspension", async () => {
    server = await startTestServer(await withOwner());
    const alice = await clients.player();
    const guest = await clients.player();
    const bob = await account("BobTest");
    const { reportId } = await reported(alice, bob);
    const { reportId: aboutGuest } = await reported(alice, guest);
    const owner = await logIn("owner@example.com");
    // The owner plays too, and someone reports them.
    const ownerPlayer = { cookie: owner.cookie, socket: await clients.openSocket(owner.cookie) };
    const { reportId: aboutOwner } = await reported(alice, ownerPlayer);
    const fine = { duration: "7d", reason: "cheating" };

    expect((await suspend(owner, reportId, { ...fine, duration: "1h" })).status).toBe(400);
    expect((await suspend(owner, reportId, { ...fine, reason: "said rude things in chat" })).status).toBe(
      400,
    );
    expect((await suspend(owner, reportId, { ...fine, note: "rude" })).status).toBe(400);
    expect((await suspend(owner, "not-a-report", fine)).status).toBe(400);
    expect((await suspend(owner, "00000000-0000-4000-8000-000000000999", fine)).status).toBe(404);
    expect((await suspend(owner, aboutGuest, fine)).status).toBe(409);
    expect((await suspend(owner, aboutOwner, fine)).body.error).toMatchObject({
      code: ERROR_CODES.CONFLICT,
      message: "An admin account can't be suspended",
    });
    expect((await suspend(owner, reportId, fine)).status).toBe(200);
    expect((await suspend(owner, reportId, fine)).body.error).toMatchObject({
      code: ERROR_CODES.CONFLICT,
      message: "This account is suspended already. Lift it first",
    });
  });
});

describe("what a suspension does to the account (CC-334, AC-2, AC-3, AC-5)", () => {
  it("ends every session of the account at once and cuts its sockets", async () => {
    server = await startTestServer(await withOwner());
    const alice = await clients.player();
    const bob = await account("BobTest");
    const secondDevice = await logIn(bob.email);
    expect(secondDevice.status).toBe(200);
    const { reportId } = await reported(alice, bob);
    const owner = await logIn("owner@example.com");
    const cut = new Promise((resolve) => bob.socket.once("disconnect", resolve));

    expect((await suspend(owner, reportId, { duration: "24h", reason: "harassment" })).status).toBe(200);

    await cut;
    for (const cookie of [bob.cookie, secondDevice.cookie]) {
      expect((await call("GET", "/session", { cookie })).body.authenticated).toBe(false);
    }
    // Its seat in the room was given up as a leave: the game it was in was forfeited to Alice.
    const rooms = await server.roomComponent.seatedRooms({ playerId: bob.identity.id });
    expect(rooms.filter((room) => room.status === "playing")).toEqual([]);
  });

  it("refuses sign-in with the end date only after the right password, and lets the player in once it ends or is lifted", async () => {
    const clock = movableClock();
    server = await startTestServer(await withOwner({ now: clock.now }));
    const alice = await clients.player();
    const bob = await account("BobTest");
    const carol = await account("CarolTest");
    const { reportId } = await reported(alice, bob);
    const { reportId: aboutCarol } = await reported(alice, carol);
    const owner = await logIn("owner@example.com");
    const { suspension } = (await suspend(owner, reportId, { duration: "24h", reason: "harassment" })).body;
    const carolSuspension = (await suspend(owner, aboutCarol, { duration: "until-lifted", reason: "other" }))
      .body.suspension;

    const wrong = await logIn(bob.email, "not the password at all");
    const refused = await logIn(bob.email);

    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe("Invalid email or password");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toEqual({
      code: ERROR_CODES.FORBIDDEN,
      message: expect.stringContaining("feedback form"),
      details: { reason: "suspended", endsAt: suspension.endsAt },
      requestId: expect.any(String),
    });
    expect(refused.cookie).toBeUndefined();
    expect(JSON.stringify(refused.body)).not.toMatch(/report|harass|Guest-/i);
    const carolRefused = await logIn(carol.email);
    expect(carolRefused.body.error.details).toEqual({ reason: "suspended" });

    clock.advance(DAY_MS);
    expect((await logIn(bob.email)).status).toBe(200);
    expect((await logIn(carol.email)).status).toBe(403);
    expect((await lift(owner, carolSuspension.suspensionId)).status).toBe(200);
    expect((await logIn(carol.email)).status).toBe(200);
  });

  it("shows the account offline to its friends", async () => {
    server = await startTestServer(await withOwner());
    const riya = await account("RiyaTest");
    const arjun = await account("ArjunTest");
    const { code, joined } = await startRoom(arjun, riya, { gameId: "race", options: { target: 3 } });
    const seats = joined.data.seats;
    const riyaSeat = { roomCode: code, seat: seats.findIndex((s) => s.playerId === joined.data.you) };
    const arjunSeat = { roomCode: code, seat: seats.findIndex((s) => s.playerId === joined.data.hostId) };
    const ask = (player, target) =>
      call("POST", "/friends/requests", { body: target, cookie: player.cookie });
    await ask(riya, { ...arjunSeat, seatId: joined.data.hostId });
    expect((await ask(arjun, { ...riyaSeat, seatId: joined.data.you })).body).toEqual({ result: "friends" });
    const report = await call("POST", "/reports", {
      body: { ...riyaSeat, seatId: joined.data.you, reason: "harassment" },
      cookie: arjun.cookie,
    });
    const presenceOfRiya = async () =>
      (await call("GET", "/friends", { cookie: arjun.cookie })).body.friends[0].presence;
    expect(await presenceOfRiya()).not.toBe("offline");
    const owner = await logIn("owner@example.com");

    await suspend(owner, report.body.report.reportId, { duration: "24h", reason: "harassment" });

    await eventually(async () => (await presenceOfRiya()) === "offline");
    // Still friends: nothing is deleted.
    expect((await call("GET", "/friends", { cookie: arjun.cookie })).body.friends).toHaveLength(1);
  });
});

describe("a request on its way when the suspension lands (CC-334, review of the branch)", () => {
  it.each([
    ["sign out other devices", "/auth/sign-out-others", undefined],
    [
      "a password change",
      "/auth/password",
      { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
    ],
  ])("mints no new session for %s that bumps the version after the suspension", async (_, path, body) => {
    const suspensionDao = createInMemorySuspensionDao();
    const owner = await withOwner({ suspensionDao });
    let landing;
    // The suspension's record lands while this request is between the session guard and its own version bump.
    const accountDao = {
      ...owner.accountDao,
      async bumpSessionVersion(change) {
        if (landing !== undefined) await landing();
        return owner.accountDao.bumpSessionVersion(change);
      },
    };
    server = await startTestServer({ ...owner, accountDao });
    const bob = await account("BobTest");
    landing = async () => {
      landing = undefined;
      await suspensionDao.insert({
        suspensionId: "00000000-0000-4000-c000-000000000001",
        playerId: bob.identity.id,
        nameThen: "BobTest",
        duration: "7d",
        reason: "harassment",
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 7 * DAY_MS),
        activeFor: bob.identity.id,
        byId: "user_aaaaaaaaaaaaaaaaaaaaaaaa",
        byName: "Owner",
      });
    };

    const res = await call("POST", path, { body, cookie: bob.cookie });

    expect(res.status).toBe(403);
    expect(res.body.error.details).toMatchObject({ reason: "suspended" });
    for (const cookie of new Set([bob.cookie, res.cookie])) {
      expect((await call("GET", "/session", { cookie })).body.authenticated).toBe(false);
    }
  });
});

describe("POST /api/auth/suspended-export (CC-334, AC-7)", () => {
  it("exports a suspended account's data with its email and password, and only for a suspended account", async () => {
    server = await startTestServer(await withOwner());
    const alice = await clients.player();
    const bob = await account("BobTest");
    const exportFor = (password = PASSWORD) =>
      call("POST", "/auth/suspended-export", { body: { email: bob.email, password } });

    expect((await exportFor()).status).toBe(409);
    const { code, reportId } = await reported(alice, bob);
    // Bob moves first with seed 42, and the race to 3 ends on Alice's move: one recorded match for Bob.
    await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
    await server.tasks.drain();
    const before = await call("POST", "/account/export", {
      body: { password: PASSWORD },
      cookie: bob.cookie,
    });
    expect(before.body.matches).toHaveLength(1);
    const owner = await logIn("owner@example.com");
    await suspend(owner, reportId, { duration: "7d", reason: "cheating" });

    expect((await exportFor("not the password at all")).status).toBe(401);
    const res = await exportFor();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="?classicade-data-\d{4}-\d{2}-\d{2}\.json/,
    );
    expect(res.body.account).toMatchObject({ username: "BobTest", email: bob.email });
    expect(res.body.suspensions).toEqual([
      {
        reason: "cheating",
        duration: "7d",
        startedAt: expect.any(String),
        endsAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(res.body.suspensions)).not.toMatch(/Owner/);
    // Nothing was deleted: every store reads as it did before the suspension, the finished game included.
    for (const store of ["matches", "progress", "gamification", "leaderboards", "chessRatings", "reports"]) {
      expect(before.body, store).toHaveProperty(store);
      expect(res.body[store], store).toEqual(before.body[store]);
    }
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.progress.xp).toBeGreaterThan(0);
    expect(res.cookie).toBeUndefined();
  });
});

describe("the console's history and current suspensions (CC-334, AC-8)", () => {
  it("shows the history and the current suspensions to the admin only, and lifts one", async () => {
    server = await startTestServer(await withOwner());
    const alice = await clients.player();
    const bob = await account("BobTest");
    const { reportId } = await reported(alice, bob);
    const owner = await logIn("owner@example.com");
    const first = (await suspend(owner, reportId, { duration: "24h", reason: "name" })).body.suspension;
    await lift(owner, first.suspensionId);
    const second = (await suspend(owner, reportId, { duration: "until-lifted", reason: "harassment" })).body
      .suspension;

    const history = await call("GET", `/admin/reports/${reportId}/suspensions`, { cookie: owner.cookie });
    const current = await call("GET", "/admin/suspensions", { cookie: owner.cookie });

    expect(history.status).toBe(200);
    expect(history.headers.get("cache-control")).toBe("no-store");
    expect(history.body.suspensions).toEqual([
      second,
      { ...first, liftedAt: expect.any(Number), liftedByName: "Owner", active: false },
    ]);
    expect(current.body.suspensions).toEqual([second]);

    const lifted = await lift(owner, second.suspensionId);
    expect(lifted.body.suspension).toMatchObject({ active: false, liftedByName: "Owner" });
    expect((await lift(owner, second.suspensionId)).status).toBe(409);
    expect((await call("GET", "/admin/suspensions", { cookie: owner.cookie })).body.suspensions).toEqual([]);

    // Everyone else gets the console's 404, on every route.
    for (const cookie of [alice.cookie, undefined]) {
      expect((await call("GET", `/admin/reports/${reportId}/suspensions`, { cookie })).status).toBe(404);
      expect((await call("GET", "/admin/suspensions", { cookie })).status).toBe(404);
      expect((await lift({ cookie }, first.suspensionId)).status).toBe(404);
      expect((await suspend({ cookie }, reportId, { duration: "24h", reason: "name" })).status).toBe(404);
    }
  });
});

describe("privacy of everyone involved (CC-334, AC-9)", () => {
  it("sends no player id shape anywhere, tells the reporter nothing and names no reporter (hasPlayerIdShape crawl)", async () => {
    server = await startTestServer(await withOwner());
    const riya = await account("RiyaTest");
    const bob = await account("BobTest");
    const { reportId } = await reported(riya, bob);
    const owner = await logIn("owner@example.com");
    const riyaPushesBefore = riya.received.length;
    const riyaExportBefore = await call("POST", "/account/export", {
      body: { password: PASSWORD },
      cookie: riya.cookie,
    });

    const answers = [
      await suspend(owner, reportId, { duration: "7d", reason: "harassment" }),
      await call("GET", `/admin/reports/${reportId}/suspensions`, { cookie: owner.cookie }),
      await call("GET", "/admin/suspensions", { cookie: owner.cookie }),
      await call("GET", "/admin/reports?status=actioned", { cookie: owner.cookie }),
      await logIn(bob.email),
      await call("POST", "/auth/suspended-export", { body: { email: bob.email, password: PASSWORD } }),
    ];
    const riyaExportAfter = await call("POST", "/account/export", {
      body: { password: PASSWORD },
      cookie: riya.cookie,
    });

    // The one id allowed is Bob's own: the guest he was before signing up, in his own export (DATA.md "own").
    const ownGuestIds = answers[5].body.guestTransfers.map((transfer) => transfer.guest);
    expect(ownGuestIds).not.toContain(riya.identity.id);
    const strings = answers.flatMap((res) => stringsIn(res.body));
    expect(strings.filter(hasPlayerIdShape).filter((id) => !ownGuestIds.includes(id))).toEqual([]);
    expect(stringsIn(answers.slice(0, 5).map((res) => res.body)).filter(hasPlayerIdShape)).toEqual([]);
    // The suspended player's answers never name who reported, or that anyone did.
    const bobSees = JSON.stringify([answers[4].body, answers[5].body.suspensions]);
    expect(bobSees).not.toContain("RiyaTest");
    expect(bobSees).not.toMatch(/report/i);
    // The reporter is told nothing: no push, and their own export says the same as before.
    // Bob's leave forfeited the game, so Riya hears what any opponent's leave brings (the room, her win), no more.
    const later = riya.received.slice(riyaPushesBefore);
    const asALeaveBrings = new Set([SOCKET_EVENTS.ROOM_UPDATED, SOCKET_EVENTS.PROGRESS_UPDATED]);
    expect(later.map((entry) => entry.event).filter((event) => !asALeaveBrings.has(event))).toEqual([]);
    expect(JSON.stringify(later)).not.toMatch(/suspen|report/i);
    expect(riyaExportAfter.body.reports).toEqual(riyaExportBefore.body.reports);
    // Her own suspensions, none: nothing in her export is about Bob's.
    expect(riyaExportAfter.body.suspensions).toEqual([]);
    expect(JSON.stringify(riyaExportAfter.body)).not.toMatch(/until lifted|"7d"/);
  });
});
