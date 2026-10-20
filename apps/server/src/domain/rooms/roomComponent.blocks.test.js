import { describe, expect, it } from "vitest";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { ConflictError } from "../../utils/errors.js";
import { createRoomComponent } from "./roomComponent.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";

// CC-044, ADR-053: a blocked pair is never seated together and never rematched, both ways. The blocked player can
// never tell a block from what anyone might do: a full room, or an opponent who declines or withdraws.
const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CAROL = Object.freeze({ kind: "guest", id: "guest_c", displayName: "Carol" });
const T0 = 1_000_000;
const REMATCH = "rematch";

/** Blocks as `[blocker, blocked]` pairs of player ids, answered the way the block component answers them. */
function fakeBlocks(pairs = []) {
  const all = [...pairs];
  const relationsOf = async ({ playerId }) => ({
    blocked: new Set(all.filter(([a]) => a === playerId).map(([, b]) => b)),
    blockedBy: new Set(all.filter(([, b]) => b === playerId).map(([a]) => a)),
  });
  return {
    add: (a, b) => all.push([a, b]),
    relationsOf,
    async blockedWith({ playerId }) {
      const { blocked, blockedBy } = await relationsOf({ playerId });
      return new Set([...blocked, ...blockedBy]);
    },
  };
}

function setup(blocks) {
  let code = 0;
  const rooms = createRoomComponent({
    seatIds: TEST_SEAT_IDS,
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

/** What a player can see of a room's rematch: its status and its requests. */
const seen = (room) => ({ status: room.status, requests: room.requests ?? [] });

/** The same finished game twice: in one Alice blocked Bob after it, in the other nobody blocked anyone. */
async function blockedAndControl() {
  const blocks = fakeBlocks();
  const blocked = setup(blocks);
  const control = setup(fakeBlocks());
  const codes = [
    await finishedGame(blocked.rooms, blocked.open),
    await finishedGame(control.rooms, control.open),
  ];
  blocks.add(ALICE.id, BOB.id);
  return { blocked: { ...blocked, code: codes[0] }, control: { ...control, code: codes[1] } };
}

const asks = ({ rooms, code }, player, now) =>
  rooms.askRequest({ code, playerId: player.id, type: REMATCH, now });
const answers = ({ rooms, code }, player, answer, now) =>
  rooms.answerRequest({ code, playerId: player.id, type: REMATCH, answer, now });

describe("roomComponent: blocked players are never rematched, and cannot tell (CC-044)", () => {
  it("opens the blocked player's request as it opens anyone's", async () => {
    const { blocked, control } = await blockedAndControl();

    const theirs = await asks(blocked, BOB, T0 + 10);
    const anyones = await asks(control, BOB, T0 + 10);

    expect(seen(theirs)).toEqual(seen(anyones));
  });

  it("turns the blocker's accept into a decline, exactly what the blocked player sees when anyone declines", async () => {
    const { blocked, control } = await blockedAndControl();
    await asks(blocked, BOB, T0 + 10);
    await asks(control, BOB, T0 + 10);

    const accepted = await answers(blocked, ALICE, "accept", T0 + 20);
    const declined = await answers(control, ALICE, "decline", T0 + 20);

    expect(seen(accepted)).toEqual(seen(declined));
    expect(accepted.status).toBe("finished");
  });

  it("turns the blocker asking back into a decline of the blocked player's request and a request of their own", async () => {
    const { blocked, control } = await blockedAndControl();
    await asks(blocked, BOB, T0 + 10);
    await asks(control, BOB, T0 + 10);

    const askedBack = await asks(blocked, ALICE, T0 + 20);
    await answers(control, ALICE, "decline", T0 + 20);
    const declinedThenAsked = await asks(control, ALICE, T0 + 20);

    expect(seen(askedBack)).toEqual(seen(declinedThenAsked));
  });

  it("ends the blocker's earlier request as withdrawn when the blocked player accepts it, as if the blocker withdrew", async () => {
    const { blocked, control } = await blockedAndControl();
    // Alice asked before she blocked Bob.
    for (const side of [blocked, control]) await asks(side, ALICE, T0 + 10);

    const accepted = await answers(blocked, BOB, "accept", T0 + 20);
    const withdrawn = await answers(control, ALICE, "withdraw", T0 + 20);

    expect(seen(accepted)).toEqual(seen(withdrawn));
  });

  it("ends it the same way when the blocked player answers by asking for a rematch too", async () => {
    const { blocked, control } = await blockedAndControl();
    for (const side of [blocked, control]) await asks(side, ALICE, T0 + 10);

    const askedToo = await asks(blocked, BOB, T0 + 20);
    await answers(control, ALICE, "withdraw", T0 + 20);
    const afterWithdraw = await asks(control, BOB, T0 + 20);

    expect(seen(askedToo)).toEqual(seen(afterWithdraw));
  });

  it("refuses a blocked player's next request with the same words as anyone's (the cooldown after a no)", async () => {
    const { blocked, control } = await blockedAndControl();
    for (const side of [blocked, control]) {
      await asks(side, BOB, T0 + 10);
      await answers(side, ALICE, side === blocked ? "accept" : "decline", T0 + 20);
    }

    const again = await asks(blocked, BOB, T0 + 21).catch((err) => err);
    const anyone = await asks(control, BOB, T0 + 21).catch((err) => err);

    expect(again).toBeInstanceOf(ConflictError);
    expect(again).toEqual(anyone);
    expect(again.details).toEqual(anyone.details);
  });

  it("still lets the blocked player withdraw their own request", async () => {
    const { blocked } = await blockedAndControl();
    await asks(blocked, BOB, T0 + 10);

    const withdrawn = await answers(blocked, BOB, "withdraw", T0 + 11);

    expect(withdrawn.requests).toEqual([expect.objectContaining({ state: "withdrawn" })]);
  });

  it("rematches players without a block between them as before", async () => {
    const { rooms, open } = setup(fakeBlocks([[ALICE.id, CAROL.id]]));
    const code = await finishedGame(rooms, open);

    await rooms.askRequest({ code, playerId: BOB.id, type: REMATCH, now: T0 + 10 });
    const next = await rooms.askRequest({ code, playerId: ALICE.id, type: REMATCH, now: T0 + 11 });

    expect(next.status).toBe("playing");
  });
});
