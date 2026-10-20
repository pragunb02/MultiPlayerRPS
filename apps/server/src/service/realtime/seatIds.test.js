import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, eventWhere, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// CC-253: what a player's browser receives about a room names the other players by opaque seat ids only.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

/** Alice hosts a race, Bob joins and moves first (seed 42), Alice wins. Answers both players' last views. */
async function finishedRace(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  const moved = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  const ended = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  return { code, aliceView: ended.data, bobView: moved.data };
}

/** Everything a socket received and every answer it got, as the text that came over the wire. */
const wire = (player, answers) => JSON.stringify([player.received, answers]);

describe("seat ids over sockets (CC-253)", () => {
  it("never sends a player the other player's id, through a game, a rematch request and a rematch", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, aliceView, bobView } = await finishedRace(alice, bob);
    const told = eventWhere(alice.socket, () => true, SOCKET_EVENTS.REQUEST_UPDATED);
    const asked = await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
    const request = await told;

    const rematch = await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

    expect(rematch.data.game.number).toBe(2);
    expect(wire(alice, [aliceView, rematch])).not.toContain(bob.identity.id);
    expect(wire(bob, [bobView, asked])).not.toContain(alice.identity.id);
    expect(request.you).toBe(aliceView.you);
    expect(request.requests).toEqual([
      expect.objectContaining({ from: bobView.you, to: aliceView.you, state: "open" }),
    ]);
    expect(request.names).toEqual({
      [aliceView.you]: alice.identity.displayName,
      [bobView.you]: bob.identity.displayName,
    });
  });

  it("keeps each seat id through the rematch, and shows both players the same ids", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { code, aliceView, bobView } = await finishedRace(alice, bob);
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

    const rematch = await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

    expect(aliceView.seats.map((seat) => seat.playerId)).toEqual([aliceView.you, bobView.you]);
    expect(bobView.seats).toEqual(aliceView.seats);
    expect(rematch.data.seats.map((seat) => seat.playerId)).toEqual([bobView.you, aliceView.you]);
    expect(rematch.data.you).toBe(aliceView.you);
  });

  it("gives the same players new, unrelated seat ids in their next room", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const first = await finishedRace(alice, bob);

    const second = await finishedRace(alice, bob);

    expect(second.code).not.toBe(first.code);
    expect(second.aliceView.you).not.toBe(first.aliceView.you);
    expect(second.bobView.you).not.toBe(first.bobView.you);
  });

  it("sends a player their own player id only where it belongs: their own identity", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const { aliceView } = await finishedRace(alice, bob);

    const identity = await send(alice.socket, SOCKET_EVENTS.IDENTITY_GET, {});

    expect(identity.data.id).toBe(alice.identity.id);
    expect(JSON.stringify(aliceView)).not.toContain(alice.identity.id);
  });
});
