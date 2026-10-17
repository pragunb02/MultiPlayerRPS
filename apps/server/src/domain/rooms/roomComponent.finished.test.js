import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { createRoomComponent, ROOM_EVENTS } from "./roomComponent.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const T0 = 1_000_000;

describe("roomComponent.listFinishedGames (CC-111)", () => {
  it("lists the game of every finished room, as the finish announced it, and nothing else", async () => {
    const published = [];
    const codes = ["ROOM22", "ROOM33"];
    const rooms = createRoomComponent({
      roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
      engines: createEngineRegistry([raceEngine]),
      events: { emit: (event, payload) => published.push({ event, payload }) },
      generateCode: () => codes.shift(),
      generateSeed: () => 42, // Bob moves first
    });
    const options = { target: 3 };
    const finished = await rooms.createRoom({ network: "n", host: ALICE, gameId: "race", options, now: T0 });
    await rooms.createRoom({ network: "n", host: ALICE, gameId: "race", options, now: T0 });
    await rooms.joinRoom({ code: finished.code, player: BOB, now: T0 + 1 });
    await rooms.makeMove({ code: finished.code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
    await rooms.makeMove({ code: finished.code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 });

    const games = await rooms.listFinishedGames();

    const announced = published.find(({ event }) => event === ROOM_EVENTS.GAME_FINISHED).payload;
    expect(games).toEqual([announced]);
  });
});
