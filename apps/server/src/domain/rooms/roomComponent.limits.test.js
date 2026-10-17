import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { ERROR_CODES, ROOM_LIMIT_REASONS } from "@classicade/shared";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { ConflictError, ServerBusyError } from "../../utils/errors.js";
import { createRoomComponent } from "./roomComponent.js";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";
import { roomLimits } from "./roomLimits.js";

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const T0 = 1_000_000;

let codeNumber = 0;
const nextCode = () => `R${String(++codeNumber).padStart(5, "0")}`;

function setup(limits = {}) {
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit: () => {} },
    limits: roomLimits(limits),
    generateCode: nextCode,
  });
  return rooms;
}

const create = (rooms, host = ALICE, now = T0, network = "net-a") =>
  rooms.createRoom({ network, host, gameId: "race", options: { target: 3 }, now });
const guest = (n) => Object.freeze({ kind: "guest", id: `guest_${n}`, displayName: `Guest${n}` });

describe("room limits (CC-107)", () => {
  describe("waiting rooms per player", () => {
    it("lets a player have three rooms waiting, and refuses the fourth with a friendly message", async () => {
      const rooms = setup();
      for (let i = 0; i < 3; i++) await create(rooms);

      const refused = await create(rooms).catch((err) => err);

      expect(refused).toBeInstanceOf(ConflictError);
      expect(refused.message).toBe("You already have 3 rooms waiting; close one first");
      expect(refused.code).toBe(ERROR_CODES.CONFLICT);
      expect(refused.details).toEqual({ reason: ROOM_LIMIT_REASONS.WAITING_ROOMS, limit: 3 });
    });

    it("counts only that player's rooms: someone else can still create theirs", async () => {
      const rooms = setup();
      for (let i = 0; i < 3; i++) await create(rooms);

      await expect(create(rooms, BOB)).resolves.toMatchObject({ hostId: BOB.id });
    });

    it("gives the place back when a waiting room is left", async () => {
      const rooms = setup();
      const first = await create(rooms);
      await create(rooms);
      await create(rooms);

      await rooms.leaveRoom({ code: first.code, playerId: ALICE.id, now: T0 + 1 });

      await expect(create(rooms, ALICE, T0 + 2)).resolves.toMatchObject({ status: "waiting" });
    });

    it("does not count a room that has started, because it is not waiting any more", async () => {
      const rooms = setup();
      const started = await create(rooms);
      await rooms.joinRoom({ code: started.code, player: BOB, now: T0 + 1 });
      await create(rooms);
      await create(rooms);

      await expect(create(rooms, ALICE, T0 + 2)).resolves.toMatchObject({ status: "waiting" });
    });

    it("does not count a waiting room whose time is up, even before the sweep closes it", async () => {
      const rooms = setup();
      await create(rooms);
      await create(rooms, ALICE, T0 + 10);
      await create(rooms, ALICE, T0 + 10);

      await expect(create(rooms, ALICE, T0 + ROOM_LIFETIMES.waitingMs)).resolves.toMatchObject({
        status: "waiting",
      });
      await expect(create(rooms, ALICE, T0 + ROOM_LIFETIMES.waitingMs)).rejects.toThrow(ConflictError);
    });

    it("follows the configured number", async () => {
      const rooms = setup({ waitingRoomsPerPlayer: 1 });
      await create(rooms);

      await expect(create(rooms)).rejects.toThrow("You already have 1 rooms waiting; close one first");
    });
  });

  describe("rooms per network (CC-107)", () => {
    it("refuses a room once the host's network has as many open rooms as allowed, whoever the guests are", async () => {
      const rooms = setup({ openRoomsPerAddress: 3 });
      for (let i = 0; i < 3; i++) await create(rooms, guest(i));

      const refused = await create(rooms, guest(9)).catch((err) => err);

      expect(refused).toBeInstanceOf(ConflictError);
      expect(refused.message).toBe("Too many rooms are open from your network. Try again later.");
      expect(refused.details).toEqual({ reason: ROOM_LIMIT_REASONS.NETWORK_ROOMS, limit: 3 });
      await expect(create(rooms, guest(9), T0, "net-b")).resolves.toMatchObject({ network: "net-b" });
    });

    it("counts rooms of every status, so joining one's own rooms does not get around it", async () => {
      const rooms = setup({ openRoomsPerAddress: 2 });
      const first = await create(rooms, guest(1));
      await rooms.joinRoom({ code: first.code, player: guest(2), now: T0 + 1 });
      await create(rooms, guest(3));

      await expect(create(rooms, guest(4))).rejects.toThrow("Too many rooms are open from your network");
    });

    it("gives the place back when one of those rooms closes", async () => {
      const rooms = setup({ openRoomsPerAddress: 1 });
      const only = await create(rooms, guest(1));
      await rooms.leaveRoom({ code: only.code, playerId: guest(1).id, now: T0 + 1 });

      await expect(create(rooms, guest(2), T0 + 2)).resolves.toMatchObject({ status: "waiting" });
    });

    it.each([[undefined], [""], [42]])(
      "refuses to create a room without the host's network (%o)",
      async (network) => {
        const rooms = setup();

        await expect(
          rooms.createRoom({ network, host: ALICE, gameId: "race", options: { target: 3 }, now: T0 }),
        ).rejects.toThrow(TypeError);
      },
    );
  });

  describe("rooms on the whole server", () => {
    it("refuses a new room once the server holds as many as it can, saying to try again in a minute", async () => {
      const rooms = setup({ openRoomsMax: 2 });
      await create(rooms, ALICE);
      await create(rooms, BOB);

      const refused = await create(rooms, { ...ALICE, id: "guest_c" }).catch((err) => err);

      expect(refused).toBeInstanceOf(ServerBusyError);
      expect(refused.code).toBe(ERROR_CODES.SERVER_BUSY);
      expect(refused.message).toBe("The server is busy, try again in a minute");
      expect(refused.details).toEqual({ reason: ROOM_LIMIT_REASONS.SERVER_FULL });
    });

    it("lets a room be created again once one has closed", async () => {
      const rooms = setup({ openRoomsMax: 1 });
      const only = await create(rooms);
      await expect(create(rooms, BOB)).rejects.toThrow(ServerBusyError);

      await rooms.leaveRoom({ code: only.code, playerId: ALICE.id, now: T0 + 1 });

      await expect(create(rooms, BOB, T0 + 2)).resolves.toMatchObject({ hostId: BOB.id });
    });

    it("still lets players join rooms that exist when the server is full", async () => {
      const rooms = setup({ openRoomsMax: 1 });
      const only = await create(rooms);

      await expect(rooms.joinRoom({ code: only.code, player: BOB, now: T0 + 1 })).resolves.toMatchObject({
        status: "playing",
      });
    });

    it("tells the player about their own limit before the server's", async () => {
      const rooms = setup({ openRoomsMax: 1, waitingRoomsPerPlayer: 1 });
      await create(rooms);

      await expect(create(rooms)).rejects.toThrow(ConflictError);
    });
  });

  it("counts open rooms per status for the gauge in the logs", async () => {
    const rooms = setup();
    const started = await create(rooms);
    await rooms.joinRoom({ code: started.code, player: BOB, now: T0 + 1 });
    await create(rooms);

    expect(await rooms.countRooms()).toEqual({ waiting: 1, playing: 1, finished: 0 });
  });
});
