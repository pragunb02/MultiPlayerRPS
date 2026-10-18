import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { ConflictError } from "../../utils/errors.js";
import { createRoomComponent } from "./roomComponent.js";

// BUG-17: a game started after the host had left the waiting room. A game now starts only when every seat is
// taken and every seated player is connected (CC-112).
const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;

/** Alice's waiting race room, over the real accessor and the in-memory store. */
async function waitingRoom() {
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit() {} },
    generateCode: () => "ROOM22",
    generateSeed: () => 42,
  });
  const room = await rooms.createRoom({
    network: "net-a",
    host: ALICE,
    gameId: "race",
    options: { target: 3 },
    now: T0,
  });
  return { rooms, code: room.code };
}

describe("roomComponent: a game starts only with everyone there (CC-112)", () => {
  it("seats a player who joins while the host is away, and does not start the game", async () => {
    const { rooms, code } = await waitingRoom();
    await rooms.playerDisconnected({ code, playerId: ALICE.id, now: T0 + 1 });

    const room = await rooms.joinRoom({ code, player: BOB, now: T0 + 2 });

    expect(room.status).toBe("waiting");
    expect(room.game).toBeUndefined();
    expect(room.seats).toEqual([
      { playerId: ALICE.id, displayName: "Alice", connected: false, away: false, since: T0 + 1 },
      { playerId: BOB.id, displayName: "Bob", connected: true, away: false, since: T0 + 2 },
    ]);
  });

  it("does not start while the host is on another page of the site, and starts once they are back (CC-207)", async () => {
    const { rooms, code } = await waitingRoom();
    await rooms.playerAway({ code, playerId: ALICE.id, now: T0 + 1 });

    const joined = await rooms.joinRoom({ code, player: BOB, now: T0 + 2 });
    const back = await rooms.joinRoom({ code, player: ALICE, now: T0 + 3 });

    expect(joined.status).toBe("waiting");
    expect(back.status).toBe("playing");
  });

  it("starts the game the moment the away host comes back", async () => {
    const { rooms, code } = await waitingRoom();
    await rooms.playerDisconnected({ code, playerId: ALICE.id, now: T0 + 1 });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 2 });

    const room = await rooms.joinRoom({ code, player: ALICE, now: T0 + 3 });

    expect(room.status).toBe("playing");
    expect(room.game.startedAt).toBe(T0 + 3);
    expect(room.seats.every((seat) => seat.connected)).toBe(true);
  });

  it("waits for every seat after a restart, and starts when the last player is back", async () => {
    const { rooms, code } = await waitingRoom();
    await rooms.playerDisconnected({ code, playerId: ALICE.id, now: T0 + 1 });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 2 });
    await rooms.markEveryoneAway({ now: T0 + 3 });

    const oneBack = await rooms.joinRoom({ code, player: BOB, now: T0 + 4 });
    const bothBack = await rooms.joinRoom({ code, player: ALICE, now: T0 + 5 });

    expect(oneBack.status).toBe("waiting");
    expect(bothBack.status).toBe("playing");
  });

  it("refuses a third player while the full room waits for its host", async () => {
    const { rooms, code } = await waitingRoom();
    await rooms.playerDisconnected({ code, playerId: ALICE.id, now: T0 + 1 });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 2 });

    await expect(rooms.joinRoom({ code, player: CAROL, now: T0 + 3 })).rejects.toThrow(
      new ConflictError("This room is full"),
    );
  });

  it("frees the seat again when the waiting player gives up and leaves", async () => {
    const { rooms, code } = await waitingRoom();
    await rooms.playerDisconnected({ code, playerId: ALICE.id, now: T0 + 1 });
    await rooms.joinRoom({ code, player: BOB, now: T0 + 2 });

    const { room } = await rooms.leaveRoom({ code, playerId: BOB.id, now: T0 + 3 });

    expect(room.status).toBe("waiting");
    expect(room.seats.map((seat) => seat.playerId)).toEqual([ALICE.id]);
  });

  it("still starts at once when the host is there", async () => {
    const { rooms, code } = await waitingRoom();

    const room = await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

    expect(room.status).toBe("playing");
  });
});

describe("roomComponent: leaving a room that was waiting (CC-112)", () => {
  it("gives up a waiting seat when asked to leave only a waiting room", async () => {
    const { rooms, code } = await waitingRoom();

    const result = await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 1, waitingOnly: true });

    expect(result).toEqual({ closed: true });
  });

  it("changes nothing once the game has started, so leaving the page never forfeits a new game", async () => {
    const { rooms, code } = await waitingRoom();
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

    const result = await rooms.leaveRoom({ code, playerId: ALICE.id, now: T0 + 2, waitingOnly: true });

    expect(result.room.status).toBe("playing");
    expect(result.room.game.log).toEqual([]);
    expect(result.room.seats.map((seat) => seat.playerId)).toEqual([ALICE.id, BOB.id]);
  });
});
