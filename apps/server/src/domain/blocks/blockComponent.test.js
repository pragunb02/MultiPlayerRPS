import { describe, expect, it } from "vitest";
import { createBlockAccessor } from "../../data/blockAccessor.js";
import { createInMemoryBlockDao } from "../../testing/inMemoryBlockDao.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";
import { createSeatIds } from "../rooms/seatIds.js";
import { createBlockComponent, MAX_BLOCKS_PER_PLAYER } from "./blockComponent.js";

const RIYA = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const ARJUN = Object.freeze({ kind: "user", id: "user_ffffffffffffffffffffffff", displayName: "Arjun" });
const GUEST = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-T001",
});
const STRANGER = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000009",
  displayName: "Guest-T009",
});
const T0 = Date.UTC(2026, 9, 19, 12);
const SEAT_IDS = createSeatIds({ secret: "seat-secret-for-tests-only-0123456789abcdef" });
// A seat id of the right shape that no seat holds.
const NOBODY = "A".repeat(22);
const MATCH_ID = "11111111-2222-4333-8444-555555555555";

const seat = (player, extra = {}) => ({ playerId: player.id, displayName: player.displayName, ...extra });

/** Open rooms by code. A code in `closed` answers GoneError, any other unknown code NotFoundError. */
function fakeRooms(rooms = {}, closed = []) {
  return {
    async getByCode(code) {
      if (closed.includes(code)) throw new GoneError("This room has closed");
      if (!Object.hasOwn(rooms, code)) throw new NotFoundError("Room not found");
      return rooms[code];
    },
  };
}

/**
 * Stored matches by id. Only their players may read them, and by their real player ids, as
 * `matchComponent.playersFor` answers them (CC-297).
 */
function fakeMatches(matches = {}) {
  return {
    async playersFor({ matchId, playerId }) {
      const match = matches[matchId];
      if (match === undefined || !match.players.some((p) => p.playerId === playerId)) {
        throw new NotFoundError("Match not found");
      }
      return match.players;
    },
  };
}

/** Guests who signed in, as `{ guestId: account }`, answered the way the transfer accessor answers them. */
function fakeTransfers(moves = {}) {
  return {
    moves,
    listFrom: async (playerIds) =>
      playerIds.filter((id) => Object.hasOwn(moves, id)).map((id) => ({ from: id, to: moves[id] })),
    listTo: async (playerId) =>
      Object.entries(moves)
        .filter(([, to]) => to.id === playerId)
        .map(([from, to]) => ({ from, to })),
  };
}

let ids = 0;
function setup({
  rooms = {},
  closed = [],
  matches = {},
  limit,
  transfers = fakeTransfers(),
  followers,
} = {}) {
  const dao = createInMemoryBlockDao();
  const blocks = createBlockComponent({
    blockAccessor: createBlockAccessor({ blockDao: dao }),
    rooms: fakeRooms(rooms, closed),
    matches: fakeMatches(matches),
    transfers,
    seatIds: SEAT_IDS,
    newBlockId: () => `00000000-0000-4000-9000-${String(++ids).padStart(12, "0")}`,
    ...(limit !== undefined && { limit }),
    ...(followers !== undefined && { followers }),
  });
  /** A seat of a room as the page names it: its place and the seat id the room view showed for it (CC-253). */
  const at = (roomCode, seatIndex) => {
    const person = rooms[roomCode]?.seats[seatIndex];
    return {
      roomCode,
      seat: seatIndex,
      seatId: person === undefined ? NOBODY : SEAT_IDS.seatIdOf(rooms[roomCode], person.playerId),
    };
  };
  return { blocks, dao, at };
}

const sharedRoom = { ROOM22: { code: "ROOM22", seats: [seat(RIYA), seat(GUEST)] } };

describe("blockComponent: followers (CC-052)", () => {
  it("tells every follower of each block, a repeated one too, before it answers", async () => {
    const told = [];
    const { blocks, at } = setup({
      rooms: sharedRoom,
      followers: [{ name: "friends", playersBlocked: async (pair) => told.push(pair) }],
    });

    await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 });
    await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 + 1 });

    expect(told).toEqual([
      { blockerId: RIYA.id, blockedId: GUEST.id },
      { blockerId: RIYA.id, blockedId: GUEST.id },
    ]);
  });

  it("refuses a follower without a way to be told, at construction", () => {
    expect(() => setup({ followers: [{ name: "friends" }] })).toThrow(/friends.playersBlocked/);
  });
});

describe("blockComponent: who can be blocked (CC-044, ADR-053)", () => {
  it("blocks the other player of an open room both sit in, by seat", async () => {
    const { blocks, at } = setup({ rooms: sharedRoom });

    const block = await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 });

    expect(block).toEqual({ blockId: expect.any(String), displayName: "Guest-T001", blockedAt: T0 });
    expect(await blocks.listFor({ blockerId: RIYA.id })).toEqual([block]);
  });

  it("blocks the other player of a stored match both played, by seat", async () => {
    const { blocks } = setup({
      matches: { [MATCH_ID]: { matchId: MATCH_ID, players: [seat(ARJUN), seat(RIYA)] } },
    });

    const block = await blocks.block({ blocker: RIYA, target: { matchId: MATCH_ID, seat: 0 }, now: T0 });

    expect(block.displayName).toBe("Arjun");
    expect(await blocks.eitherBlocked({ a: ARJUN.id, b: RIYA.id })).toBe(true);
  });

  it.each([
    ["a room that does not exist", { roomCode: "NOPE22", seat: 1 }],
    ["a room that has closed", { roomCode: "GONE22", seat: 1 }],
    ["a room the blocker does not sit in", { roomCode: "OTHER2", seat: 1 }],
    ["a seat past the last one", { roomCode: "ROOM22", seat: 2 }],
    ["their own seat", { roomCode: "ROOM22", seat: 0 }],
    ["a computer character", { roomCode: "BOTS22", seat: 1 }],
    ["a deleted player's stand-in", { roomCode: "DELE22", seat: 1 }],
    ["a match they did not play", { matchId: MATCH_ID, seat: 0 }],
    ["a match that does not exist", { matchId: "99999999-2222-4333-8444-555555555555", seat: 0 }],
  ])("refuses %s with the same not found answer, and stores nothing", async (_, target) => {
    const { blocks, dao, at } = setup({
      closed: ["GONE22"],
      rooms: {
        ...sharedRoom,
        OTHER2: { code: "OTHER2", seats: [seat(ARJUN), seat(STRANGER)] },
        BOTS22: {
          code: "BOTS22",
          seats: [
            seat(RIYA),
            { playerId: "bot_rocky_easy", displayName: "Rocky", bot: { character: "rocky" } },
          ],
        },
        DELE22: {
          code: "DELE22",
          seats: [seat(RIYA), { playerId: "deleted_6c1d", displayName: "Deleted player" }],
        },
      },
      matches: { [MATCH_ID]: { matchId: MATCH_ID, players: [seat(ARJUN), seat(STRANGER)] } },
    });

    const named = "roomCode" in target ? at(target.roomCode, target.seat) : target;

    const refusal = await blocks.block({ blocker: RIYA, target: named, now: T0 }).catch((err) => err);

    expect(refusal).toBeInstanceOf(NotFoundError);
    expect(refusal.message).toBe("You can only block someone you played with");
    expect(refusal.details).toEqual({});
    expect(await dao.listInvolving(RIYA.id)).toEqual([]);
  });

  it.each([
    ["the seats were swapped", [seat(GUEST), seat(RIYA)]],
    ["someone else took the seat", [seat(RIYA), seat(STRANGER)]],
  ])(
    "refuses a seat that no longer holds the person the page showed (%s), and blocks nobody",
    async (_, seatsNow) => {
      const rooms = { ROOM22: { seats: [seat(RIYA), seat(GUEST)] } };
      const { blocks, dao, at } = setup({ rooms });
      const shown = at("ROOM22", 1);
      rooms.ROOM22 = { seats: seatsNow };

      await expect(blocks.block({ blocker: RIYA, target: shown, now: T0 })).rejects.toThrow(
        "You can only block someone you played with",
      );
      expect(await dao.listInvolving(RIYA.id)).toEqual([]);
    },
  );

  it("refuses a seat named by the player id of the person in it: the page only ever knows seat ids (CC-253)", async () => {
    const { blocks, dao } = setup({ rooms: sharedRoom });

    const refusal = blocks.block({
      blocker: RIYA,
      target: { roomCode: "ROOM22", seat: 1, seatId: GUEST.id },
      now: T0,
    });

    await expect(refusal).rejects.toThrow(NotFoundError);
    expect(await dao.listInvolving(RIYA.id)).toEqual([]);
  });

  it("refuses to be built without seat ids", () => {
    expect(() =>
      createBlockComponent({
        blockAccessor: createBlockAccessor({ blockDao: createInMemoryBlockDao() }),
        rooms: fakeRooms(),
        matches: fakeMatches(),
        transfers: fakeTransfers(),
      }),
    ).toThrow(TypeError);
  });

  it("refuses to be built without a way to read the real players of a match (CC-297)", () => {
    expect(() =>
      createBlockComponent({
        blockAccessor: createBlockAccessor({ blockDao: createInMemoryBlockDao() }),
        rooms: fakeRooms(),
        matches: { getForPlayer: async () => ({ players: [] }) },
        transfers: fakeTransfers(),
        seatIds: SEAT_IDS,
      }),
    ).toThrow(TypeError);
  });

  it("refuses a computer character in a stored match like a stranger", async () => {
    const { blocks } = setup({
      matches: {
        [MATCH_ID]: {
          matchId: MATCH_ID,
          players: [seat(RIYA), { playerId: "bot_rocky_easy", displayName: "Rocky", computer: true }],
        },
      },
    });

    await expect(
      blocks.block({ blocker: RIYA, target: { matchId: MATCH_ID, seat: 1 }, now: T0 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lets anything but a missing room or match through, so a broken store is never taken for a stranger", async () => {
    const failing = new Error("database down");
    const blocks = createBlockComponent({
      blockAccessor: createBlockAccessor({ blockDao: createInMemoryBlockDao() }),
      rooms: {
        getByCode: async () => {
          throw failing;
        },
      },
      matches: fakeMatches(),
      transfers: fakeTransfers(),
      seatIds: SEAT_IDS,
    });
    const target = { roomCode: "ROOM22", seat: 1, seatId: NOBODY };

    await expect(blocks.block({ blocker: RIYA, target, now: T0 })).rejects.toBe(failing);
  });
});

describe("blockComponent: blocks are silent and work both ways (ADR-053)", () => {
  it("answers everyone on either side of a block with a player, and nobody else", async () => {
    const { blocks, at } = setup({
      rooms: { ...sharedRoom, ARJ222: { code: "ARJ222", seats: [seat(ARJUN), seat(RIYA)] } },
    });
    await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 });
    await blocks.block({ blocker: ARJUN, target: at("ARJ222", 1), now: T0 });

    expect([...(await blocks.blockedWith({ playerId: RIYA.id }))].sort()).toEqual(
      [ARJUN.id, GUEST.id].sort(),
    );
    expect([...(await blocks.blockedWith({ playerId: GUEST.id }))]).toEqual([RIYA.id]);
    expect([...(await blocks.blockedWith({ playerId: STRANGER.id }))]).toEqual([]);
    expect(await blocks.eitherBlocked({ a: GUEST.id, b: RIYA.id })).toBe(true);
    expect(await blocks.eitherBlocked({ a: GUEST.id, b: ARJUN.id })).toBe(false);
  });

  it("never lists who blocked a player: the blocked player's list stays empty", async () => {
    const { blocks, at } = setup({ rooms: sharedRoom });
    await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 });

    expect(await blocks.listFor({ blockerId: GUEST.id })).toEqual([]);
    expect(await blocks.exportPlayer({ playerId: GUEST.id })).toEqual([]);
  });

  it("blocking someone already blocked changes nothing and answers the same block", async () => {
    const { blocks, at } = setup({ rooms: sharedRoom });
    const first = await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 });

    const again = await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 + 5 });

    expect(again).toEqual(first);
    expect(await blocks.listFor({ blockerId: RIYA.id })).toHaveLength(1);
  });

  it("unblocks only the blocker's own block, and answers not found for anyone else's", async () => {
    const { blocks, at } = setup({ rooms: sharedRoom });
    const { blockId } = await blocks.block({
      blocker: RIYA,
      target: at("ROOM22", 1),
      now: T0,
    });

    await expect(blocks.unblock({ blockerId: GUEST.id, blockId })).rejects.toThrow(NotFoundError);
    expect(await blocks.eitherBlocked({ a: RIYA.id, b: GUEST.id })).toBe(true);

    await blocks.unblock({ blockerId: RIYA.id, blockId });

    expect(await blocks.eitherBlocked({ a: RIYA.id, b: GUEST.id })).toBe(false);
    await expect(blocks.unblock({ blockerId: RIYA.id, blockId })).rejects.toThrow(NotFoundError);
  });

  it(`keeps at most ${MAX_BLOCKS_PER_PLAYER} blocks per player, dropping the oldest`, async () => {
    const players = [ARJUN, GUEST, STRANGER];
    const rooms = Object.fromEntries(
      players.map((player, index) => [`ROOM${index}A`, { seats: [seat(RIYA), seat(player)] }]),
    );
    const { blocks, at } = setup({ rooms, limit: 2 });

    for (const [index] of players.entries()) {
      await blocks.block({ blocker: RIYA, target: at(`ROOM${index}A`, 1), now: T0 + index });
    }

    expect((await blocks.listFor({ blockerId: RIYA.id })).map((block) => block.displayName)).toEqual([
      "Guest-T009",
      "Guest-T001",
    ]);
    expect(await blocks.eitherBlocked({ a: RIYA.id, b: ARJUN.id })).toBe(false);
    expect(MAX_BLOCKS_PER_PLAYER).toBe(500);
  });
});

describe("blockComponent: blocks follow a guest who signs in (ADR-014)", () => {
  it("moves the blocks the guest made and the blocks on the guest, once", async () => {
    const { blocks, at } = setup({
      rooms: {
        G1: { seats: [seat(GUEST), seat(ARJUN)] },
        G2: { seats: [seat(STRANGER), seat(GUEST)] },
      },
    });
    await blocks.block({ blocker: GUEST, target: at("G1", 1), now: T0 });
    await blocks.block({ blocker: STRANGER, target: at("G2", 1), now: T0 });

    expect(await blocks.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 + 1 })).toEqual({
      moved: { blocks: 2 },
    });
    expect(await blocks.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 + 2 })).toEqual({
      moved: { blocks: 0 },
    });

    expect(await blocks.eitherBlocked({ a: RIYA.id, b: ARJUN.id })).toBe(true);
    expect(await blocks.eitherBlocked({ a: RIYA.id, b: STRANGER.id })).toBe(true);
    expect([...(await blocks.blockedWith({ playerId: GUEST.id }))]).toEqual([]);
    // The blocker still sees the name they blocked, never the account the guest became.
    expect((await blocks.listFor({ blockerId: STRANGER.id }))[0].displayName).toBe("Guest-T001");
  });

  it("blocks the account when the guest at the seat signed in after the seat was read", async () => {
    const transfers = fakeTransfers();
    const rooms = { G1: { seats: [seat(ARJUN), seat(GUEST)] } };
    const { blocks, at } = setup({ rooms, transfers });
    const target = at("G1", 1);
    // The guest signs in and their blocks move before this block is stored (the race in the review of #107).
    transfers.moves[GUEST.id] = RIYA;

    await blocks.block({ blocker: ARJUN, target, now: T0 });

    expect(await blocks.eitherBlocked({ a: ARJUN.id, b: RIYA.id })).toBe(true);
    expect((await blocks.listFor({ blockerId: ARJUN.id }))[0].displayName).toBe("Guest-T001");
  });

  it("refuses a block on the player's own guest seat once that guest has become them", async () => {
    const transfers = fakeTransfers({ [GUEST.id]: RIYA });
    const { blocks, at, dao } = setup({ rooms: { G1: { seats: [seat(RIYA), seat(GUEST)] } }, transfers });

    await expect(blocks.block({ blocker: RIYA, target: at("G1", 1), now: T0 })).rejects.toThrow(
      NotFoundError,
    );
    expect(await dao.listInvolving(RIYA.id)).toEqual([]);
  });

  it("still applies a block stored under a guest id whose owner has signed in since, both ways", async () => {
    const transfers = fakeTransfers();
    const { blocks, dao } = setup({ transfers });
    await dao.insert({
      blockId: "00000000-0000-4000-9000-0000000000aa",
      blockerId: ARJUN.id,
      blockedId: GUEST.id,
      blockedName: "Guest-T001",
      createdAt: new Date(T0),
    });
    await dao.insert({
      blockId: "00000000-0000-4000-9000-0000000000ab",
      blockerId: GUEST.id,
      blockedId: STRANGER.id,
      blockedName: "Guest-T009",
      createdAt: new Date(T0),
    });
    // A guest who blocked the account they later became is no block at all.
    await dao.insert({
      blockId: "00000000-0000-4000-9000-0000000000ac",
      blockerId: GUEST.id,
      blockedId: RIYA.id,
      blockedName: "Riya",
      createdAt: new Date(T0),
    });
    transfers.moves[GUEST.id] = RIYA;

    expect([...(await blocks.blockedWith({ playerId: RIYA.id }))].sort()).toEqual(
      [ARJUN.id, STRANGER.id].sort(),
    );
    expect([...(await blocks.blockedWith({ playerId: ARJUN.id }))]).toEqual([RIYA.id]);
    expect(await blocks.relationsOf({ playerId: RIYA.id })).toEqual({
      blocked: new Set([STRANGER.id]),
      blockedBy: new Set([ARJUN.id]),
    });
  });

  it("keeps the cap after the move", async () => {
    const { blocks, at } = setup({
      limit: 1,
      rooms: { G1: { seats: [seat(GUEST), seat(ARJUN)] }, R1: { seats: [seat(RIYA), seat(STRANGER)] } },
    });
    await blocks.block({ blocker: RIYA, target: at("R1", 1), now: T0 });
    await blocks.block({ blocker: GUEST, target: at("G1", 1), now: T0 + 1 });

    await blocks.transferPlayer({ from: GUEST.id, to: RIYA, now: T0 + 2 });

    expect((await blocks.listFor({ blockerId: RIYA.id })).map((block) => block.displayName)).toEqual([
      "Arjun",
    ]);
  });
});

describe("blockComponent: deletion and export (ADR-048.2)", () => {
  it("exports the blocks the player made, by name and time only", async () => {
    const { blocks, at } = setup({ rooms: sharedRoom });
    await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 });

    expect(await blocks.exportPlayer({ playerId: RIYA.id })).toEqual([
      { displayName: "Guest-T001", blockedAt: new Date(T0).toISOString() },
    ]);
  });

  it("erases every block on either side of the player, and running it twice changes nothing", async () => {
    const { blocks, at } = setup({
      rooms: { ...sharedRoom, ARJ222: { seats: [seat(ARJUN), seat(RIYA)] } },
    });
    await blocks.block({ blocker: RIYA, target: at("ROOM22", 1), now: T0 });
    await blocks.block({ blocker: ARJUN, target: at("ARJ222", 1), now: T0 });

    expect(await blocks.erasePlayer({ playerId: RIYA.id })).toEqual({ erased: { blocks: 2 } });
    expect(await blocks.erasePlayer({ playerId: RIYA.id })).toEqual({ erased: { blocks: 0 } });

    expect(await blocks.listFor({ blockerId: ARJUN.id })).toEqual([]);
  });
});
