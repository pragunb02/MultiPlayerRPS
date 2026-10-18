import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { clockOn, startTestServer } from "../../testing/testApp.js";

// CC-032: a guest's XP and match history move to the account they sign up for or log in to.
// Race engine, seed 42: the second seat moves first. Bob +1, Alice +2 → Alice (the host) wins.
// A win is 30 XP; the day's quests may add a bonus (CC-089) — they depend on the player id and the (pinned) day.
const DAY = "2026-10-01";
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

/** Bonus XP the player's daily quests have paid today (CC-089). */
async function questBonus(cookie) {
  const { quests } = await get("/quests", cookie);
  const done = quests.items.filter((item) => item.completedAt !== null);
  return (
    done.reduce((xp, item) => xp + item.bonusXp, 0) +
    (quests.sweep.completedAt === null ? 0 : quests.sweep.bonusXp)
  );
}

/** Alice (host) beats Bob once; resolves when the match and its XP are stored. */
async function aliceBeatsBob(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await server.tasks.drain();
}

describe("a guest's progress follows them to their account (CC-032)", () => {
  it("signing up brings the guest's XP and matches, and says what moved", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);
    const xp = 30 + (await questBonus(alice.cookie));

    const signedUp = await post("/api/auth/signup", RIYA, alice.cookie);
    const { progress } = await get("/progress", signedUp.cookie);
    const { matches } = await get("/matches", signedUp.cookie);
    const { match } = await get(`/matches/${matches[0].matchId}`, signedUp.cookie);

    expect(signedUp.status).toBe(201);
    expect(signedUp.body.carriedOver).toEqual({ xp, matchesPlayed: 1, matches: 1 });
    expect(progress).toEqual(expect.objectContaining({ xp, matchesPlayed: 1, wins: 1 }));
    expect(matches).toHaveLength(1);
    expect(matches[0].outcomeForYou).toBe("win");
    expect(match.players.map((p) => p.displayName)).toEqual(["Riya", bob.identity.displayName]);
    expect(match.log.map((entry) => entry.playerId)).not.toContain(alice.identity.id);
  });

  it("logging in adds the guest's XP to the account's and joins the histories", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const account = await post("/api/auth/signup", RIYA);
    const accountSocket = await clients.openSocket(account.cookie);
    const opponent = await clients.player();
    await aliceBeatsBob({ socket: accountSocket }, opponent); // the account wins once: 30 XP (+ quest bonus)
    const guest = await clients.player();
    const friend = await clients.player();
    await aliceBeatsBob(friend, guest); // the guest loses once: 10 XP
    const bonus = { account: await questBonus(account.cookie), guest: await questBonus(guest.cookie) };

    const loggedIn = await post(
      "/api/auth/login",
      { email: RIYA.email, password: RIYA.password },
      guest.cookie,
    );
    const { progress } = await get("/progress", loggedIn.cookie);
    const { matches } = await get("/matches", loggedIn.cookie);

    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.carriedOver).toEqual({ xp: 10 + bonus.guest, matchesPlayed: 1, matches: 1 });
    expect(progress).toEqual(
      expect.objectContaining({ xp: 40 + bonus.account + bonus.guest, matchesPlayed: 2, wins: 1, losses: 1 }),
    );
    expect(matches.map((m) => m.outcomeForYou).sort()).toEqual(["loss", "win"]);
  });

  it("a guest who hasn't played brings nothing, and the answer says nothing about it", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const guest = await clients.player();

    const signedUp = await post("/api/auth/signup", RIYA, guest.cookie);

    expect(signedUp.body).toEqual({ identity: expect.objectContaining({ displayName: "Riya" }) });
  });

  it("signing in without a guest session moves nothing", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    await post("/api/auth/signup", RIYA);

    const loggedIn = await post("/api/auth/login", { email: RIYA.email, password: RIYA.password });

    expect(loggedIn.body).not.toHaveProperty("carriedOver");
  });

  it("moves the guest's data exactly once, however often the move is repeated", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);
    const xp = 30 + (await questBonus(alice.cookie));
    const signedUp = await post("/api/auth/signup", RIYA, alice.cookie);
    const move = () =>
      server.playerTransferComponent.transfer({
        from: alice.identity.id,
        to: signedUp.body.identity,
        now: Date.now(),
      });

    const repeats = await Promise.all([move(), move(), move()]);

    expect(repeats).toEqual([{}, {}, {}]);
    expect((await get("/progress", signedUp.cookie)).progress.xp).toBe(xp);
    expect((await get("/matches", signedUp.cookie)).matches).toHaveLength(1);
  });

  it("moves the guest's data once when two sign-ins from the same guest session race", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    await post("/api/auth/signup", RIYA);
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);
    const xp = 30 + (await questBonus(alice.cookie));
    const login = () => post("/api/auth/login", { email: RIYA.email, password: RIYA.password }, alice.cookie);

    const [first, second] = await Promise.all([login(), login()]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await get("/progress", first.cookie)).progress.xp).toBe(xp);
    expect((await get("/matches", second.cookie)).matches).toHaveLength(1);
  });

  // A double-clicked "Create account" that still sends twice, or two tabs (CC-245).
  it("makes one account and moves the guest's data once when two sign-ups from one guest session race", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);
    const xp = 30 + (await questBonus(alice.cookie));
    const signup = () => post("/api/auth/signup", RIYA, alice.cookie);

    const answers = await Promise.all([signup(), signup()]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    const created = answers.find((answer) => answer.status === 201);
    expect((await get("/progress", created.cookie)).progress.xp).toBe(xp);
    expect((await get("/matches", created.cookie)).matches).toHaveLength(1);
  });

  it("a match that finishes while its guest signs in lands on the account", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
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
    // The account's id is random, so is its quest set: "Get a win" (+20) may or may not be among them. Which
    // player the quest counted for depends on how the race went; the win's XP always lands on the account.
    expect(progress).toEqual(expect.objectContaining({ matchesPlayed: 1, wins: 1 }));
    expect([30, 50]).toContain(progress.xp);
    expect(matches).toHaveLength(1);
  });

  it("never fails the sign-in when moving data fails; housekeeping finishes the move later", async () => {
    let failNext = true;
    server = await startTestServer({
      now: clockOn(DAY),
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
    const xp = 30 + (await questBonus(alice.cookie));

    const signedUp = await post("/api/auth/signup", RIYA, alice.cookie);
    const resumed = await server.playerTransferComponent.resumePending({ now: Date.now() + 60_000 });

    expect(signedUp.status).toBe(201);
    expect(signedUp.body).not.toHaveProperty("carriedOver");
    expect(server.find("moving the previous identity's data failed")[0]).toEqual(
      expect.objectContaining({ playerId: signedUp.body.identity.id, previousPlayerId: alice.identity.id }),
    );
    expect(resumed).toEqual({ completed: [alice.identity.id], failed: [] });
    expect((await get("/progress", signedUp.cookie)).progress.xp).toBe(xp);
  });

  it("brings the guest's achievements, streaks and quest XP along (CC-054, CC-089)", async () => {
    server = await startTestServer({ now: clockOn(DAY) });
    const alice = await clients.player();
    const bob = await clients.player();
    await aliceBeatsBob(alice, bob);
    await aliceBeatsBob(alice, bob);
    const unlocked = async (cookie) =>
      (await get("/achievements", cookie)).achievements.filter((a) => a.unlockedAt !== null);
    const asGuest = {
      unlocked: await unlocked(alice.cookie),
      streaks: (await get("/streaks", alice.cookie)).streaks,
    };
    const xp = 60 + (await questBonus(alice.cookie));

    const signedUp = await post("/api/auth/signup", RIYA, alice.cookie);
    const { streaks } = await get("/streaks", signedUp.cookie);
    const again = await server.playerTransferComponent.transfer({
      from: alice.identity.id,
      to: signedUp.body.identity,
      now: Date.now(),
    });

    expect(asGuest.unlocked.map((a) => a.id)).toEqual(expect.arrayContaining(["first-match", "first-win"]));
    expect(await unlocked(signedUp.cookie)).toEqual(asGuest.unlocked);
    expect(streaks.win).toEqual({ current: 2, best: 2 });
    expect(streaks.daily).toEqual(asGuest.streaks.daily);
    expect(signedUp.body.carriedOver).toEqual({ xp, matchesPlayed: 2, matches: 2 });
    expect(again).toEqual({});
    expect((await get("/progress", signedUp.cookie)).progress.xp).toBe(xp);
  });
});
