import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { ConflictError } from "../../utils/errors.js";
import { createRoomComponent } from "./roomComponent.js";

// CC-044, ADR-053: a blocked pair is never seated together and never rematched, both ways, and the refusal says
// nothing a refusal for any other reason would not say.
const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;
const REMATCH = "rematch";

/** Blocks between pairs of player ids, as the block component answers them. */
function fakeBlocks(pairs = []) {
  const all = [...pairs];
  return {
    add: (a, b) => all.push([a, b]),
    async blockedWith({ playerId }) {
      return new Set(all.flatMap(([a, b]) => (a === playerId ? [b] : b === playerId ? [a] : [])));
    },
  };
}

function setup(blocks) {
  let code = 0;
  const rooms = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry([raceEngine]),
    events: { emit() {} },
    generateCode: () => `ROOM${String(++code).padStart(2, "0")}`,
    generateSeed: () => 42,
    blocks,
  });
  const open = async (host) =>
    (await rooms.createRoom({ network: "net-a", host, gameId: "race", options: { target: 3 }, now: T0 }))
      .code;
  return { rooms, open };
}

/** Alice hosts, Bob joins, Bob then Alice move, and Alice wins (race, seed 42: the second seat moves first). */
async function finishedGame(rooms, open) {
  const code = await open(ALICE);
  await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
  await rooms.makeMove({ code, playerId: BOB.id, move: { add: 1 }, now: T0 + 2 });
  await rooms.makeMove({ code, playerId: ALICE.id, move: { add: 2 }, now: T0 + 3 });
  return code;
}

describe("roomComponent: blocked players are never seated together (CC-044)", () => {
  it.each([
    ["the host blocked the player who joins", [ALICE.id, BOB.id]],
    ["the player who joins blocked the host", [BOB.id, ALICE.id]],
  ])("refuses the seat when %s, with exactly the full room answer", async (_, pair) => {
    const { rooms, open } = setup(fakeBlocks([pair]));
    const code = await open(ALICE);

    const refusal = await rooms.joinRoom({ code, player: BOB, now: T0 + 1 }).catch((err) => err);

    const full = new ConflictError("This room is full");
    expect(refusal).toEqual(full);
    expect(refusal.code).toBe(full.code);
    expect(refusal.details).toEqual({});
    expect((await rooms.getRoom(code)).seats.map((seat) => seat.playerId)).toEqual([ALICE.id]);
  });

  it("seats anyone else as before", async () => {
    const { rooms, open } = setup(fakeBlocks([[ALICE.id, BOB.id]]));
    const code = await open(ALICE);

    const room = await rooms.joinRoom({ code, player: CAROL, now: T0 + 1 });

    expect(room.status).toBe("playing");
  });

  it("still lets a seated player come back to their seat", async () => {
    const blocks = fakeBlocks();
    const { rooms, open } = setup(blocks);
    const code = await open(ALICE);
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });
    blocks.add(ALICE.id, BOB.id);
    await rooms.playerDisconnected({ code, playerId: BOB.id, now: T0 + 2 });

    const back = await rooms.joinRoom({ code, player: BOB, now: T0 + 3 });

    expect(back.seats.find((seat) => seat.playerId === BOB.id).connected).toBe(true);
  });

  it("answers a game that already started the same way for a blocked player as for anyone", async () => {
    const { rooms, open } = setup(fakeBlocks([[ALICE.id, CAROL.id]]));
    const code = await open(ALICE);
    await rooms.joinRoom({ code, player: BOB, now: T0 + 1 });

    await expect(rooms.joinRoom({ code, player: CAROL, now: T0 + 2 })).rejects.toEqual(
      new ConflictError("This game has already started"),
    );
  });
});

describe("roomComponent: blocked players are never rematched (CC-044)", () => {
  it.each([
    ["the winner blocked the loser", [ALICE.id, BOB.id]],
    ["the loser blocked the winner", [BOB.id, ALICE.id]],
  ])("refuses a rematch asked by either player when %s, without saying why", async (_, pair) => {
    const blocks = fakeBlocks();
    const { rooms, open } = setup(blocks);
    const code = await finishedGame(rooms, open);
    blocks.add(...pair);

    for (const player of [ALICE, BOB]) {
      const refusal = await rooms
        .askRequest({ code, playerId: player.id, type: REMATCH, now: T0 + 10 })
        .catch((err) => err);

      expect(refusal).toEqual(new ConflictError("A rematch is not possible now"));
      expect(refusal.details).toEqual({});
    }
    expect((await rooms.getRoom(code)).requests ?? []).toEqual([]);
  });

  it("refuses to accept a rematch asked before the block, and leaves it to end unanswered", async () => {
    const blocks = fakeBlocks();
    const { rooms, open } = setup(blocks);
    const code = await finishedGame(rooms, open);
    await rooms.askRequest({ code, playerId: BOB.id, type: REMATCH, now: T0 + 10 });
    blocks.add(ALICE.id, BOB.id);

    await expect(
      rooms.answerRequest({ code, playerId: ALICE.id, type: REMATCH, answer: "accept", now: T0 + 11 }),
    ).rejects.toEqual(new ConflictError("A rematch is not possible now"));
    await expect(rooms.askRequest({ code, playerId: ALICE.id, type: REMATCH, now: T0 + 12 })).rejects.toEqual(
      new ConflictError("A rematch is not possible now"),
    );

    const room = await rooms.getRoom(code);
    expect(room.status).toBe("finished");
    expect(room.requests).toEqual([expect.objectContaining({ from: BOB.id, state: "open" })]);
  });

  it("still lets the blocker decline, and the blocked player withdraw", async () => {
    const blocks = fakeBlocks();
    const { rooms, open } = setup(blocks);
    const code = await finishedGame(rooms, open);
    await rooms.askRequest({ code, playerId: BOB.id, type: REMATCH, now: T0 + 10 });
    blocks.add(ALICE.id, BOB.id);

    const declined = await rooms.answerRequest({
      code,
      playerId: ALICE.id,
      type: REMATCH,
      answer: "decline",
      now: T0 + 11,
    });

    expect(declined.requests).toEqual([expect.objectContaining({ state: "declined" })]);
  });

  it("rematches players without a block between them as before", async () => {
    const { rooms, open } = setup(fakeBlocks([[ALICE.id, CAROL.id]]));
    const code = await finishedGame(rooms, open);

    await rooms.askRequest({ code, playerId: BOB.id, type: REMATCH, now: T0 + 10 });
    const next = await rooms.askRequest({ code, playerId: ALICE.id, type: REMATCH, now: T0 + 11 });

    expect(next.status).toBe("playing");
  });
});
