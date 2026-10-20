import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
import { createInMemoryReportDao } from "../../testing/inMemoryReportDao.js";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";
import { createPasswordHasher } from "../../utils/passwordHasher.js";
import { REPORT_LIMITS } from "./reportRoutes.js";

// CC-044, ADR-071: reporting a player over HTTP, and the owner's queue. The other player is named by where the two
// met, never by an id; the reporter is thanked the same way every time; the reported player is never told; and only
// an admin sees the queue, which carries no player id.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const PASSWORD = "correct horse battery";
const NOT_FOUND = { code: ERROR_CODES.NOT_FOUND, message: "We couldn't find that player" };

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(cookie && { cookie }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    headers: res.headers,
    text,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
  };
}

const report = (player, body) => call("POST", "/reports", { body, cookie: player.cookie });
const error = (res) => ({ code: res.body.error?.code, message: res.body.error?.message });

const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, item]) => [key, ...stringsIn(item)])
      : [];

/** Alice hosts a race, Bob joins and moves first (seed 42), Alice wins. Answers the room and each one's seat id. */
async function finishedRace(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  const moved = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  const ended = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await server.tasks.drain();
  const bobSeatId = moved.data.you;
  return {
    code,
    matchId: ended.data.game.matchId,
    bobSeat: {
      roomCode: code,
      seat: ended.data.seats.findIndex((s) => s.playerId === bobSeatId),
      seatId: bobSeatId,
    },
  };
}

/** An owner account made before the server starts, so ADMIN_ACCOUNT_IDS can name it, as on Render. */
async function withOwner() {
  const accountDao = createInMemoryAccountDao();
  const { accountId } = await accountDao.insert({
    username: "Owner",
    email: "owner@example.com",
    passwordHash: await createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }).hash(PASSWORD),
    createdAt: new Date(),
  });
  return { accountDao, env: { ADMIN_ACCOUNT_IDS: `user_${accountId}` } };
}

async function logIn(email) {
  const res = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
  return { cookie: res.cookie, identity: res.body.identity };
}

describe("POST /api/reports (CC-044)", () => {
  it("reports the other player of a room seat and answers only a report id and time, with no player id", async () => {
    const reportDao = createInMemoryReportDao();
    server = await startTestServer({ reportDao });
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { bobSeat } = await finishedRace(alice, bob);
    const bobFramesBefore = bob.received.length;

    const res = await report(alice, { ...bobSeat, reason: "name", note: "Mail me at a@b.co" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ report: { reportId: expect.any(String), createdAt: expect.any(Number) } });
    expect(stringsIn(res.body).filter(hasPlayerIdShape)).toEqual([]);
    const stored = await reportDao.getById(res.body.report.reportId);
    expect(stored).toMatchObject({
      reporterId: alice.identity.id,
      reportedId: bob.identity.id,
      reportedName: bob.identity.displayName,
      note: "Mail me at [email removed]",
    });
    // Bob is never told: nothing his socket received after the game names a report (the game's own pushes may land).
    const later = JSON.stringify(bob.received.slice(bobFramesBefore));
    expect(later).not.toMatch(/report/i);
    expect(later).not.toContain(res.body.report.reportId);
  });

  it("reports a player of a stored match by its place, after they left the room", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, matchId } = await finishedRace(alice, bob);
    await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code });
    const { body } = await call("GET", `/matches/${matchId}`, { cookie: alice.cookie });
    const seat = body.match.players.findIndex((p) => p.playerId !== body.match.you);

    const res = await report(alice, { matchId, seat, reason: "cheating" });

    expect(res.status).toBe(200);
  });

  it("answers the same report again for a second one on the same player the same day", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { bobSeat } = await finishedRace(alice, bob);

    const first = await report(alice, { ...bobSeat, reason: "name" });
    const again = await report(alice, { ...bobSeat, reason: "other" });

    expect(again.body).toEqual(first.body);
  });

  it("answers one 404 for a stranger, yourself and a handle nobody has", async () => {
    server = await startTestServer();
    const [alice, bob, carol] = [await clients.player(), await clients.player(), await clients.player()];
    const { bobSeat, code } = await finishedRace(alice, bob);
    const self = await report(alice, {
      roomCode: code,
      seat: bobSeat.seat === 0 ? 1 : 0,
      seatId: "A".repeat(22),
      reason: "name",
    });

    const answers = [
      await report(carol, { ...bobSeat, reason: "name" }),
      self,
      await report(alice, { handle: "zzzzzzzzzzzzzzzz", reason: "name" }),
    ];

    expect(answers.map(error)).toEqual(answers.map(() => NOT_FOUND));
  });

  it("refuses a player id, an unknown reason, a long note and anything else in the body with 400", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { bobSeat } = await finishedRace(alice, bob);

    const answers = [
      await report(alice, { ...bobSeat, reason: "name", playerId: bob.identity.id }),
      await report(alice, { ...bobSeat, seatId: bob.identity.id, reason: "name" }),
      await report(alice, { ...bobSeat, reason: "spam" }),
      await report(alice, { ...bobSeat }),
      await report(alice, { ...bobSeat, reason: "name", note: "x".repeat(501) }),
      await report(alice, { ...bobSeat, reason: "name", note: 5 }),
      await report(alice, { handle: "short", reason: "name" }),
      await report(alice, [bobSeat]),
    ];

    expect(answers.map((res) => res.status)).toEqual(answers.map(() => 400));
  });

  it("answers 401 to a visitor without a session", async () => {
    server = await startTestServer();

    expect(
      (await call("POST", "/reports", { body: { handle: "zzzzzzzzzzzzzzzz", reason: "name" } })).status,
    ).toBe(401);
  });

  it(`allows ${REPORT_LIMITS.perPlayer.limit} reports a day per player, then answers 429, and counts the address after the player`, async () => {
    server = await startTestServer({
      reportLimits: {
        perPlayer: { ...REPORT_LIMITS.perPlayer, limit: 2 },
        perAddress: { ...REPORT_LIMITS.perAddress, limit: 3 },
      },
    });
    const [alice, bob, carol] = [await clients.player(), await clients.player(), await clients.player()];
    const body = { handle: "zzzzzzzzzzzzzzzz", reason: "name" };

    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await report(alice, body)).status);
    statuses.push((await report(bob, body)).status, (await report(carol, body)).status);

    // Alice's two count for the address, her refused ones do not: Bob's is the third, and Carol's the refused fourth.
    expect(statuses).toEqual([404, 404, 429, 429, 404, 429]);
  });

  it("lets the reporter block the reported player in one tap, by the report's id, and nobody else", async () => {
    server = await startTestServer();
    const [alice, bob, carol] = [await clients.player(), await clients.player(), await clients.player()];
    const { bobSeat } = await finishedRace(alice, bob);
    const { reportId } = (await report(alice, { ...bobSeat, reason: "harassment" })).body.report;

    const blocked = await call("POST", "/blocks", { body: { reportId }, cookie: alice.cookie });
    const theirs = await call("POST", "/blocks", { body: { reportId }, cookie: carol.cookie });
    const malformed = await call("POST", "/blocks", { body: { reportId: "nope" }, cookie: alice.cookie });
    expect(malformed.status).toBe(400);

    expect(blocked.status).toBe(200);
    expect(blocked.body.block.displayName).toBe(bob.identity.displayName);
    expect(theirs.status).toBe(404);
    expect(stringsIn(blocked.body).filter(hasPlayerIdShape)).toEqual([]);
  });
});

describe("the owner's report queue, /api/admin/reports (CC-044, ADR-071.6)", () => {
  it("answers everyone but an admin the console's 404, and an admin the groups without any player id", async () => {
    server = await startTestServer(await withOwner());
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { bobSeat } = await finishedRace(alice, bob);
    await report(alice, { ...bobSeat, reason: "name", note: "<script>alert(1)</script>" });
    const owner = await logIn("owner@example.com");

    const asGuest = await call("GET", "/admin/reports", { cookie: alice.cookie });
    const asVisitor = await call("GET", "/admin/reports");
    const asOwner = await call("GET", "/admin/reports", { cookie: owner.cookie });

    for (const res of [asGuest, asVisitor]) {
      expect(res.status).toBe(404);
      expect(error(res)).toEqual(error(await call("GET", "/admin/nothing-here", { cookie: alice.cookie })));
    }
    expect(asOwner.status).toBe(200);
    expect(asOwner.headers.get("cache-control")).toBe("no-store");
    expect(asOwner.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(asOwner.headers.get("content-type")).toMatch(/^application\/json/);
    const [group] = asOwner.body.groups;
    expect(group).toMatchObject({
      kind: "guest",
      names: [bob.identity.displayName],
      reports: 1,
      reporters: 1,
    });
    // The note is sent as the text it is, for the page to show as text.
    expect(group.items[0].note).toBe("<script>alert(1)</script>");
    expect(stringsIn(asOwner.body).filter(hasPlayerIdShape)).toEqual([]);
    expect(asOwner.text).not.toContain(alice.identity.id);
    expect(asOwner.text).not.toContain(bob.identity.id);
  });

  it("refuses an unknown status or query parameter with 400", async () => {
    server = await startTestServer(await withOwner());
    const owner = await logIn("owner@example.com");

    expect((await call("GET", "/admin/reports?status=all", { cookie: owner.cookie })).status).toBe(400);
    expect((await call("GET", "/admin/reports?player=x", { cookie: owner.cookie })).status).toBe(400);
  });

  it("renames a reported account to the safe default everywhere, signs it out, and closes its reports", async () => {
    server = await startTestServer(await withOwner());
    const signup = await call("POST", "/auth/signup", {
      body: { username: "RudeName", email: "rude@example.com", password: PASSWORD },
    });
    const rude = { cookie: signup.cookie, identity: signup.body.identity };
    rude.socket = await clients.openSocket(rude.cookie);
    const alice = await clients.player();
    const { bobSeat } = await finishedRace(alice, rude);
    const { reportId } = (await report(alice, { ...bobSeat, reason: "name" })).body.report;
    const owner = await logIn("owner@example.com");
    const cut = new Promise((resolve) => rude.socket.once("disconnect", resolve));

    const res = await call("POST", `/admin/reports/${reportId}/actions`, {
      body: { action: "rename" },
      cookie: owner.cookie,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      result: { closed: 1, displayName: expect.stringMatching(/^Player_[A-Z2-9]{6}$/) },
    });
    await cut;
    expect((await call("GET", "/session", { cookie: rude.cookie })).body.authenticated).toBe(false);
    const again = await logIn("rude@example.com");
    expect(again.identity.displayName).toBe(res.body.result.displayName);
    expect((await call("GET", "/admin/reports", { cookie: owner.cookie })).body.groups).toEqual([]);
    expect(
      (await call("GET", "/admin/reports?status=actioned", { cookie: owner.cookie })).body.groups[0].items[0],
    ).toMatchObject({ action: "rename" });
  });

  it("dismisses a group, refuses an unknown action, a closed group, a malformed id, and answers others 404", async () => {
    server = await startTestServer(await withOwner());
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { bobSeat } = await finishedRace(alice, bob);
    const { reportId } = (await report(alice, { ...bobSeat, reason: "name" })).body.report;
    const owner = await logIn("owner@example.com");
    const act = (body, cookie = owner.cookie, id = reportId) =>
      call("POST", `/admin/reports/${id}/actions`, { body, cookie });

    expect((await act({ action: "dismiss" }, alice.cookie)).status).toBe(404);
    expect((await act({ action: "suspend" })).status).toBe(400);
    expect((await act({ action: "dismiss", extra: 1 })).status).toBe(400);
    expect((await act({ action: "dismiss" }, owner.cookie, "nope")).status).toBe(400);
    expect((await act({ action: "rename" })).status).toBe(409);
    expect((await act({ action: "dismiss" })).body).toEqual({ result: { closed: 1 } });
    expect((await act({ action: "dismiss" })).status).toBe(409);
  });
});

describe("reports in the account export and deletion (CC-044, ADR-071.7)", () => {
  it("exports the reports the account made, without the reported player's id, and keeps them nameless after deletion", async () => {
    const reportDao = createInMemoryReportDao();
    server = await startTestServer({ reportDao });
    const signup = await call("POST", "/auth/signup", {
      body: { username: "Reporter", email: "reporter@example.com", password: PASSWORD },
    });
    const riya = { cookie: signup.cookie, identity: signup.body.identity };
    riya.socket = await clients.openSocket(riya.cookie);
    const bob = await clients.player();
    const { code } = await startRoom(riya, bob, { gameId: "race", options: { target: 3 } });
    const view = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
    const seat = view.data.seats.findIndex((s) => s.playerId === view.data.you);
    const { reportId } = (
      await report(riya, { roomCode: code, seat, seatId: view.data.you, reason: "harassment", note: "kept" })
    ).body.report;

    const exported = await call("POST", "/account/export", {
      body: { password: PASSWORD },
      cookie: riya.cookie,
    });

    expect(exported.status).toBe(200);
    expect(exported.body.reports).toEqual([
      {
        reason: "harassment",
        note: "kept",
        where: "room",
        displayName: bob.identity.displayName,
        reportedAt: expect.any(String),
      },
    ]);
    expect(JSON.stringify(exported.body.reports)).not.toContain(bob.identity.id);

    const deleted = await call("POST", "/account/delete", {
      body: { password: PASSWORD },
      cookie: riya.cookie,
    });
    expect(deleted.status).toBe(204);
    const kept = await reportDao.getById(reportId);
    expect(kept.reporterId).toMatch(/^deleted_/);
    expect(kept).not.toHaveProperty("note");
  });
});
