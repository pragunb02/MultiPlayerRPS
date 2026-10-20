import { afterEach, describe, expect, it } from "vitest";
import { CHALLENGE_STATES, ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { createSocketClients, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// CC-052 part 2: invites to friends over HTTP, through the real friends and flags. Only a friend can be invited, and
// only while the friend_invites flag is on for the sender. Everyone else gets the same 404. No answer and no push
// carries a player id.
let server;
const clients = createSocketClients(() => server.baseUrl);
const RACE = Object.freeze({ gameId: "race", options: { target: 3 } });

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(`${server.baseUrl}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? {} : JSON.parse(text) };
}

/** A guest who signs up as an adult, with a socket on the account's session that logs every push. */
async function account(username) {
  const player = await clients.player();
  const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: player.cookie },
    body: JSON.stringify({
      username,
      email: `${username.toLowerCase()}@example.com`,
      password: "correct horse battery",
      birthYear: 1990,
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

/** The two play a race and become friends. Answers each one's handle as the other's friends view shows it. */
async function befriend(a, b) {
  const { code, joined } = await startRoom(a, b, RACE);
  const seats = joined.data.seats;
  const seatOf = (seatId) => ({
    roomCode: code,
    seat: seats.findIndex((s) => s.playerId === seatId),
    seatId,
  });
  await call("POST", "/friends/requests", { body: seatOf(joined.data.you), cookie: a.cookie });
  expect(
    (await call("POST", "/friends/requests", { body: seatOf(joined.data.hostId), cookie: b.cookie })).body,
  ).toEqual({ result: "friends" });
  // How `b` names `a` for a block: `a`'s seat in the room they played in.
  return { aSeat: seatOf(joined.data.hostId) };
}

const invite = (from, handle) =>
  call("POST", "/challenges", { body: { ...RACE, to: { handle } }, cookie: from.cookie });
const answer = (player, id, what) => call("POST", `/challenges/${id}/${what}`, { cookie: player.cookie });
const errorOf = (res) => ({
  status: res.status,
  code: res.body.error?.code,
  message: res.body.error?.message,
});

/** Every string anywhere in a value. */
const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, each]) => [key, ...stringsIn(each)])
      : [];

async function start(on) {
  server = await startTestServer();
  if (on) await server.flagComponent.setRollout({ name: "friend_invites", rollout: "on" });
}

describe("invites to friends over HTTP (CC-052 part 2)", () => {
  flagPaths("friend_invites", (on) => {
    it("invites a friend, and refuses everyone else with one 404", async () => {
      await start(on);
      const riya = await account("RiyaTest");
      const arjun = await account("ArjunTest");
      const meera = await account("MeeraTest");
      const guest = await clients.player();
      await befriend(riya, arjun);
      const { aSeat: riyasSeat } = await befriend(riya, meera);
      const arjunsHandle = (await call("GET", "/friends", { cookie: riya.cookie })).body.friends.find(
        (friend) => friend.displayName === "ArjunTest",
      ).handle;
      const riyasHandle = (await call("GET", "/friends", { cookie: arjun.cookie })).body.friends[0].handle;
      const meerasHandle = (await call("GET", "/friends", { cookie: riya.cookie })).body.friends.find(
        (friend) => friend.displayName === "MeeraTest",
      ).handle;

      const toArjun = await invite(riya, arjunsHandle);
      // Meera blocks Riya: the friendship ends, and an invite to her reads as one to a stranger.
      expect((await call("POST", "/blocks", { body: riyasSeat, cookie: meera.cookie })).status).toBe(200);

      const refusals = [
        await invite(meera, arjunsHandle), // not Meera's friend
        await invite(arjun, "zzzzzzzzzzzzzzzz"), // nobody's handle
        await invite(guest, riyasHandle), // a guest has no friends
      ];
      if (on) {
        expect(toArjun.status).toBe(201);
        expect(toArjun.body.challenge).toMatchObject({ toName: "ArjunTest", toOne: true, own: true });
      } else {
        refusals.push(toArjun);
      }
      refusals.push(await invite(riya, meerasHandle));
      for (const refusal of refusals) {
        expect(errorOf(refusal)).toEqual({
          status: 404,
          code: ERROR_CODES.NOT_FOUND,
          message: "We couldn't find that player",
        });
      }
    });

    it("lets the first friend play, fills the other invite and lets its friend invite back", async () => {
      await start(on);
      const riya = await account("RiyaTest");
      const arjun = await account("ArjunTest");
      const meera = await account("MeeraTest");
      await befriend(riya, arjun);
      await befriend(riya, meera);
      const friends = (await call("GET", "/friends", { cookie: riya.cookie })).body.friends;
      const handleOf = (name) => friends.find((friend) => friend.displayName === name).handle;
      const toArjun = await invite(riya, handleOf("ArjunTest"));
      const toMeera = await invite(riya, handleOf("MeeraTest"));
      if (!on) {
        expect([toArjun.status, toMeera.status]).toEqual([404, 404]);
        return;
      }

      expect((await answer(arjun, toArjun.body.challenge.id, "accept")).status).toBe(200);
      const meeras = await call("GET", `/challenges/${toMeera.body.challenge.id}`, { cookie: meera.cookie });
      const notHers = await answer(arjun, toMeera.body.challenge.id, "again");
      const back = await answer(meera, toMeera.body.challenge.id, "again");

      expect(meeras.body.challenge).toMatchObject({ state: CHALLENGE_STATES.FILLED, fromName: "RiyaTest" });
      expect(notHers.status).toBe(403);
      expect(back.status).toBe(201);
      expect(back.body.challenge).toMatchObject({
        own: true,
        toName: "RiyaTest",
        state: CHALLENGE_STATES.OPEN,
      });
    });

    it("sends no player id in any invite answer or push", async () => {
      await start(on);
      const riya = await account("RiyaTest");
      const arjun = await account("ArjunTest");
      const meera = await account("MeeraTest");
      await befriend(riya, arjun);
      await befriend(riya, meera);
      const answers = [];
      const keep = async (res) => {
        answers.push(res.body);
        return res.body;
      };
      const friends = await keep(await call("GET", "/friends", { cookie: riya.cookie }));
      const handleOf = (name) => friends.friends.find((friend) => friend.displayName === name).handle;

      const toArjun = await keep(await invite(riya, handleOf("ArjunTest")));
      const toMeera = await keep(await invite(riya, handleOf("MeeraTest")));
      if (on) {
        await keep(await answer(arjun, toArjun.challenge.id, "accept"));
        await keep(await answer(meera, toMeera.challenge.id, "again"));
        await keep(await answer(riya, toArjun.challenge.id, "again"));
      }
      for (const player of [riya, arjun, meera]) {
        await keep(await call("GET", "/challenges", { cookie: player.cookie }));
      }
      const pushes = [riya, arjun, meera].flatMap((player) =>
        player.received.filter(({ event }) => event === SOCKET_EVENTS.CHALLENGE_UPDATED),
      );

      if (on) expect(pushes.length).toBeGreaterThanOrEqual(5);
      else expect(pushes).toEqual([]);
      expect(stringsIn([answers, pushes]).filter(hasPlayerIdShape)).toEqual([]);
    });
  });
});
