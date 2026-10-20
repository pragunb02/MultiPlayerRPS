import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { DELETED_ID_PREFIX } from "../../models/deletedPlayer.js";
import { ACCOUNT_ID_PREFIX, GUEST_ID_PREFIX } from "../../models/identity.js";
import { createSocketClients, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// CC-297: a crawl of everything a finished match sends a player, over HTTP and over sockets. No answer may hold a
// person's player id other than the viewer's own: not the list, the details, the export, the result screen, the
// rematch, the request popup or the progress push, before and after the opponent signs in.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const PASSWORD = "correct horse battery";
// Anything that starts the way a person's player id does (a guest, an account, or a deleted player's stand-in) and
// is not inside a longer token, so a keyed id that happens to hold the same letters is not counted.
const PERSON_ID = new RegExp(
  `(?<![A-Za-z0-9_-])(?:${GUEST_ID_PREFIX}|${ACCOUNT_ID_PREFIX}|${DELETED_ID_PREFIX})[A-Za-z0-9-]+`,
  "g",
);

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, body: await res.json(), cookie: setCookie ? setCookie.split(";")[0] : cookie };
}

/** A guest who signs up: the account's session, a socket on it, and every id the person has had. */
async function signUp(player, username) {
  const signedUp = await call("POST", "/auth/signup", {
    body: { username, email: `${username.toLowerCase()}@example.com`, password: PASSWORD },
    cookie: player.cookie,
  });
  const socket = await clients.openSocket(signedUp.cookie);
  socket.onAny((event, payload) => player.received.push({ event, payload }));
  return {
    ...player,
    cookie: signedUp.cookie,
    socket,
    account: true,
    ownIds: [...(player.ownIds ?? [player.identity.id]), signedUp.body.identity.id],
  };
}

/** Alice hosts a race, Bob joins and moves first (seed 42), Alice wins. Answers every acknowledgement. */
async function race(host, guest) {
  const { code, joined, created } = await startRoom(host, guest, { gameId: "race", options: { target: 3 } });
  const answers = [created, joined];
  answers.push(await send(guest.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } }));
  answers.push(await send(host.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } }));
  return { code, answers };
}

/**
 * Everything match history and a finished match send this player now: the list, every match's details, the
 * export for an account, every leaderboard the match moved them on with their own standing (`you`), and everything
 * their sockets received.
 */
async function crawl(player, answers) {
  const get = async (path) => (await call("GET", path, { cookie: player.cookie })).body;
  const list = await get("/matches");
  const details = await Promise.all(list.matches.map(({ matchId }) => get(`/matches/${matchId}`)));
  const exported = player.account
    ? (await call("POST", "/account/export", { body: { password: PASSWORD }, cookie: player.cookie })).body
    : {};
  const { boards } = await get("/leaderboards");
  const standings = await Promise.all(boards.map(({ id }) => get(`/leaderboards/${id}`)));
  return { list, details, exported, standings, wire: JSON.stringify([player.received, answers]) };
}

/** Every person's id in the crawl that is not one of the viewer's own. */
const strangersIn = (crawled, player) =>
  [...JSON.stringify(crawled).matchAll(PERSON_ID)]
    .map(([id]) => id)
    .filter((id) => !(player.ownIds ?? [player.identity.id]).includes(id));

describe("no match-related answer carries another person's id (CC-297)", () => {
  it("crawls the list, the details, the export, the result, the rematch and the pushes of both players", async () => {
    server = await startTestServer();
    const alice = await signUp(await clients.player(), "Alice");
    let bob = await clients.player();
    const first = await race(alice, bob);
    const asked = await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code: first.code, type: "rematch" });
    const rematch = await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, {
      code: first.code,
      type: "rematch",
    });
    // Whoever the rematch lets move first adds 1, and the other wins with 2.
    const [opener, closer] = rematch.data.game.activePlayers.includes(rematch.data.you)
      ? [alice, bob]
      : [bob, alice];
    const second = [
      await send(opener.socket, SOCKET_EVENTS.GAME_MOVE, { code: first.code, move: { add: 1 } }),
      await send(closer.socket, SOCKET_EVENTS.GAME_MOVE, { code: first.code, move: { add: 2 } }),
    ];
    await server.tasks.drain();
    const aliceAnswers = [...first.answers, rematch, ...second];
    const bobAnswers = [...first.answers, asked, ...second];

    const forAlice = await crawl(alice, aliceAnswers);
    const forBob = await crawl(bob, bobAnswers);
    bob = await signUp(bob, "Bobby");
    await server.tasks.drain();
    const forAliceAfter = await crawl(alice, aliceAnswers);
    const forBobAfter = await crawl(bob, bobAnswers);

    expect(forAlice.list.matches).toHaveLength(2);
    expect(forAliceAfter.details).toHaveLength(2);
    expect(forBobAfter.exported.matches).toHaveLength(2);
    expect(forAlice.wire).toContain(SOCKET_EVENTS.PROGRESS_UPDATED);
    // The boards list the guest opponent's row too (ADR-060), and each viewer's own standing.
    const rows = forAlice.standings.flatMap((standing) => standing.entries.map((entry) => entry.displayName));
    expect(rows).toContain(bob.identity.displayName);
    expect(forBob.standings.some((standing) => standing.you?.listed)).toBe(true);
    // The crawl does find an id that does not belong to the viewer.
    expect(strangersIn({ planted: bob.identity.id }, alice)).toEqual([bob.identity.id]);
    expect(strangersIn(forAlice, alice)).toEqual([]);
    expect(strangersIn(forBob, bob)).toEqual([]);
    expect(strangersIn(forAliceAfter, alice)).toEqual([]);
    expect(strangersIn(forBobAfter, bob)).toEqual([]);
  });

  it("names the viewer by `you` and the opponent by name in the list, and both see the same ids", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    await race(alice, bob);
    await server.tasks.drain();

    const [forAlice] = (await call("GET", "/matches", { cookie: alice.cookie })).body.matches;
    const [forBob] = (await call("GET", "/matches", { cookie: bob.cookie })).body.matches;

    const opponentOf = (match) => match.players.find((p) => p.playerId !== match.you);
    expect(opponentOf(forBob).displayName).toBe(alice.identity.displayName);
    expect(opponentOf(forAlice).displayName).toBe(bob.identity.displayName);
    expect(forAlice.players).toEqual(forBob.players);
    expect(forAlice.result.winners).toEqual([forAlice.you]);
    expect(forAlice.you).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
