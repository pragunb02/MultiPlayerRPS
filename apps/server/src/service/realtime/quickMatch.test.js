import { afterEach, expect, it } from "vitest";
import { ENGINES } from "@classicade/games";
import { QUICK_MATCH_OUTCOMES, SOCKET_EVENTS } from "@classicade/shared";
import { hasPlayerIdShape } from "../../models/playerIdShape.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { createSocketClients, send } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// Quick match over real sockets (CC-051, ADR-079), with the real engines and characters, behind its flag. The
// search is shortened here so the suite stays quick. The browser test keeps the real 4 s (CC-236).
const SEARCH_MS = 400;

let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const stringsIn = (value) =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? Object.values(value).flatMap(stringsIn)
      : [];

async function start(on) {
  server = await startTestServer({ engines: ENGINES, matchmakingRules: { searchMs: SEARCH_MS } });
  if (on) await server.flagComponent.setRollout({ name: "quick_match", rollout: "on" });
}

const quick = (player, gameId = "rps") =>
  send(player.socket, SOCKET_EVENTS.MATCH_QUICK, { gameId, level: "easy" });
const hasComputer = (view) => view.seats.some((seat) => seat.bot !== undefined);

flagPaths("quick_match", (on) => {
  it(
    on
      ? "two players pressing Play at once meet in one started game, named only by seat ids"
      : "each player pressing Play gets the character at once, as before",
    async () => {
      await start(on);
      const alice = await clients.player();
      const bob = await clients.player();

      const [forAlice, forBob] = await Promise.all([quick(alice), quick(bob)]);

      expect(forAlice.ok && forBob.ok).toBe(true);
      if (!on) {
        expect([forAlice.data.outcome, forBob.data.outcome]).toEqual(["character", "character"]);
        expect(forAlice.data.room.code).not.toBe(forBob.data.room.code);
        expect(hasComputer(forAlice.data.room)).toBe(true);
        return;
      }
      expect([forAlice.data.outcome, forBob.data.outcome]).toEqual(["person", "person"]);
      expect(forAlice.data.room.code).toBe(forBob.data.room.code);
      expect(forAlice.data.room.status).toBe("playing");
      expect(hasComputer(forAlice.data.room)).toBe(false);
      expect(forAlice.data.room.seats.map((seat) => seat.displayName).sort()).toEqual(
        [alice.identity.displayName, bob.identity.displayName].sort(),
      );
      // No player id reaches either client, in the answers or in anything pushed (ADR-057, CC-297).
      const strings = [forAlice, forBob, ...alice.received, ...bob.received].flatMap(stringsIn);
      expect(strings.filter(hasPlayerIdShape)).toEqual([]);
      expect(strings).not.toContain(alice.identity.id);
      expect(strings).not.toContain(bob.identity.id);
      // The room is the real one: either player can move in it.
      const joined = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: forBob.data.room.code });
      expect(joined.data.status).toBe("playing");
    },
  );

  it(
    on
      ? "plays the character when nobody else searches, after the search time"
      : "plays the character at once when nobody else searches",
    async () => {
      await start(on);
      const alice = await clients.player();
      // Bob is on the site, so the site is not empty and the search runs.
      await clients.player();

      const pressed = Date.now();
      const answer = await quick(alice);
      const waited = Date.now() - pressed;

      expect(answer.data.outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
      expect(answer.data.room.status).toBe("playing");
      expect(answer.data.room.seats[1]).toEqual(
        expect.objectContaining({ displayName: "Rocky", bot: { character: "rocky", level: "easy" } }),
      );
      expect(waited >= SEARCH_MS).toBe(on);
    },
  );

  it("skips the search on an empty site: the character at once", async () => {
    await start(on);
    const alice = await clients.player();

    const pressed = Date.now();
    const answer = await quick(alice, "tictactoe");

    expect(answer.data.outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
    expect(answer.data.room.seats[1].displayName).toBe("Pip");
    expect(Date.now() - pressed).toBeLessThan(SEARCH_MS);
  });

  it(`a closed tab ${on ? "leaves the search at once, so nobody meets it" : "changes nothing"}`, async () => {
    await start(on);
    const alice = await clients.player();
    const bob = await clients.player();
    await clients.player();

    const searching = quick(alice).catch(() => "cut off");
    await new Promise((resolve) => setTimeout(resolve, 50));
    alice.socket.disconnect();
    await searching;
    const answer = await quick(bob);

    expect(answer.data.outcome).toBe(QUICK_MATCH_OUTCOMES.CHARACTER);
  });

  it(`cancel ${on ? "ends a search still looking, with one answer" : "has nothing to end"}`, async () => {
    await start(on);
    const alice = await clients.player();
    await clients.player();

    const searching = quick(alice);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cancel = await send(alice.socket, SOCKET_EVENTS.MATCH_CANCEL);

    expect(cancel).toEqual({ ok: true, data: { cancelled: on } });
    expect((await searching).data.outcome).toBe(on ? "cancelled" : "character");
  });

  it("refuses a payload that names options, a seat or a player", async () => {
    await start(on);
    const alice = await clients.player();

    const answer = await send(alice.socket, SOCKET_EVENTS.MATCH_QUICK, {
      gameId: "chess",
      level: "easy",
      options: { timeControl: "bullet-1+0" },
    });

    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe("VALIDATION_FAILED");
  });
});
