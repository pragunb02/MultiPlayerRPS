import { describe, expect, it } from "vitest";
import { GAME_IDS, ROOM_CLOSE_REASONS } from "@classicade/shared";
import { botRooms, PERSON } from "../../testing/botRooms.js";
import { ROOM_EVENTS } from "./roomComponent.js";

// How rooms treat a computer player (CC-138). The rules a computer plays by are in botTurns.test.js.

describe("roomComponent with computer players", () => {
  it("publishes every saved change, and only saved changes", async () => {
    const { playComputer, rooms, changes } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });

    await rooms.playerDisconnected({ code: room.code, playerId: PERSON.id, now: 2 });

    expect(changes.at(-1)).toEqual({ event: ROOM_EVENTS.CHANGED, payload: { room: expect.any(Object) } });
    expect(changes.at(-1).payload.room.seats[0].connected).toBe(false);
    const seen = changes.length;
    await rooms.markEveryoneAway({ now: 3 });
    expect(changes).toHaveLength(seen);
  });

  it("closes the room once the person leaves a finished game, because a computer never plays alone", async () => {
    const { playComputer, rooms, published } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });
    await rooms.leaveRoom({ code: room.code, playerId: PERSON.id, now: 2 });

    const result = await rooms.leaveRoom({ code: room.code, playerId: PERSON.id, now: 3 });

    expect(result).toEqual({ closed: true });
    expect(published.at(-1)).toEqual({
      event: ROOM_EVENTS.CLOSED,
      payload: { code: room.code, reason: ROOM_CLOSE_REASONS.EMPTY },
    });
  });

  it("forfeits to the computer when the person leaves a game still on", async () => {
    const { playComputer, rooms } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });

    const { room: left } = await rooms.leaveRoom({ code: room.code, playerId: PERSON.id, now: 2 });

    expect(left.result).toEqual(expect.objectContaining({ winners: ["bot_rocky_easy"], reason: "forfeit" }));
  });

  it("keeps the computer connected after a restart, while people show as away until they rejoin", async () => {
    const { playComputer, rooms } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });

    await rooms.markEveryoneAway({ now: 2 });

    const seats = (await rooms.getRoom(room.code)).seats;
    expect(seats.map((seat) => [seat.playerId, seat.connected])).toEqual([
      [PERSON.id, false],
      ["bot_rocky_easy", true],
    ]);
    expect(await rooms.markEveryoneAway({ now: 3 })).toEqual([]);
  });

  it("refuses a second person in a game against the computer, because it has started", async () => {
    const { playComputer, rooms } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });

    await expect(
      rooms.joinRoom({
        code: room.code,
        player: { kind: "guest", id: "guest_b", displayName: "Bob" },
        now: 2,
      }),
    ).rejects.toThrow("This game has already started");
  });
});
