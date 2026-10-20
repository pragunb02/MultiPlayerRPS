import { describe, expect, it } from "vitest";
import { GoneError, NotFoundError } from "../../utils/errors.js";
import { createSeatIds } from "../rooms/seatIds.js";
import { createCoPlayers } from "./coPlayers.js";

const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const BOT = "bot_pip_easy";
const MATCH_ID = "11111111-2222-4333-8444-555555555555";
const SEAT_IDS = createSeatIds({ secret: "seat-secret-for-tests-only-0123456789abcdef" });

class Refused extends Error {}
const refusal = (cause) => new Refused("not played with", cause === undefined ? {} : { cause });

const room = (seats, extra = {}) => ({
  code: "ROOM22",
  createdAt: 1,
  seats: seats.map(([playerId, displayName]) => ({ playerId, displayName })),
  ...extra,
});

function setup({ rooms = {}, closed = [], matches = {}, moves = {}, failing } = {}) {
  return createCoPlayers({
    rooms: {
      async getByCode(code) {
        if (failing !== undefined) throw failing;
        if (closed.includes(code)) throw new GoneError("closed");
        if (!Object.hasOwn(rooms, code)) throw new NotFoundError("no room");
        return rooms[code];
      },
    },
    matches: {
      async playersFor({ matchId, playerId }) {
        const players = matches[matchId];
        if (players === undefined || !players.some((p) => p.playerId === playerId))
          throw new NotFoundError("no");
        return players;
      },
    },
    transfers: {
      listFrom: async (ids) =>
        ids.filter((id) => Object.hasOwn(moves, id)).map((id) => ({ from: id, to: moves[id] })),
    },
    seatIds: SEAT_IDS,
  });
}

const seatOf = (stored, index) => ({
  roomCode: stored.code,
  seat: index,
  seatId: SEAT_IDS.seatIdOf(stored, stored.seats[index].playerId),
});

describe("co-players: only people you played with (ADR-053.3, CC-052)", () => {
  it("needs its four sources", () => {
    expect(() => createCoPlayers({})).toThrow(/rooms.getByCode/);
  });

  it("finds the other person of an open room both sit in, by seat and seat id", async () => {
    const stored = room([
      [RIYA, "Riya"],
      [ARJUN, "Arjun"],
    ]);
    const coPlayers = setup({ rooms: { ROOM22: stored } });

    expect(await coPlayers.personAt({ target: seatOf(stored, 1), askerId: RIYA, refusal })).toEqual({
      playerId: ARJUN,
      displayName: "Arjun",
      quickMatch: false,
    });
  });

  it("says when the two met in quick match, which marks its rooms (CC-051)", async () => {
    const stored = room(
      [
        [RIYA, "Riya"],
        [ARJUN, "Arjun"],
      ],
      { quickMatch: true },
    );
    const coPlayers = setup({ rooms: { ROOM22: stored } });

    expect((await coPlayers.personAt({ target: seatOf(stored, 1), askerId: RIYA, refusal })).quickMatch).toBe(
      true,
    );
  });

  it("finds the other player of a stored match, and answers the account a guest became", async () => {
    const coPlayers = setup({
      matches: {
        [MATCH_ID]: [
          { playerId: GUEST, displayName: "Guest-T001" },
          { playerId: RIYA, displayName: "Riya" },
        ],
      },
      moves: { [GUEST]: { id: ARJUN } },
    });

    expect(
      await coPlayers.personAt({ target: { matchId: MATCH_ID, seat: 0 }, askerId: RIYA, refusal }),
    ).toEqual({
      playerId: ARJUN,
      displayName: "Guest-T001",
      quickMatch: false,
    });
  });

  it.each([
    ["the asker's own seat", { seat: 0 }],
    ["an empty seat", { seat: 3 }],
    ["a seat that holds someone else now", { seatId: "A".repeat(22) }],
    ["a computer player", { seat: 2 }],
  ])("refuses %s with the caller's one refusal", async (_case, change) => {
    const stored = room([
      [RIYA, "Riya"],
      [ARJUN, "Arjun"],
      [BOT, "Pip"],
    ]);
    const coPlayers = setup({ rooms: { ROOM22: stored } });
    const target = { ...seatOf(stored, 1), ...change };
    if (change.seat !== undefined && stored.seats[change.seat] !== undefined && change.seatId === undefined) {
      target.seatId = SEAT_IDS.seatIdOf(stored, stored.seats[change.seat].playerId);
    }

    await expect(coPlayers.personAt({ target, askerId: RIYA, refusal })).rejects.toThrow(Refused);
  });

  it("refuses a room the asker does not sit in, a closed one and a missing one alike", async () => {
    const stored = room([
      [ARJUN, "Arjun"],
      [GUEST, "Guest-T001"],
    ]);
    const coPlayers = setup({ rooms: { ROOM22: stored }, closed: ["GONE22"] });

    for (const target of [
      seatOf(stored, 0),
      { ...seatOf(stored, 0), roomCode: "GONE22" },
      { ...seatOf(stored, 0), roomCode: "NONE22" },
    ]) {
      await expect(coPlayers.personAt({ target, askerId: RIYA, refusal })).rejects.toThrow(Refused);
    }
  });

  it("refuses a guest who became the asker's own account", async () => {
    const coPlayers = setup({
      matches: {
        [MATCH_ID]: [
          { playerId: GUEST, displayName: "Guest-T001" },
          { playerId: RIYA, displayName: "Riya" },
        ],
      },
      moves: { [GUEST]: { id: RIYA } },
    });

    await expect(
      coPlayers.personAt({ target: { matchId: MATCH_ID, seat: 0 }, askerId: RIYA, refusal }),
    ).rejects.toThrow(Refused);
  });

  it("passes on any other failure as it is", async () => {
    const coPlayers = setup({ failing: new Error("database down") });

    await expect(
      coPlayers.personAt({
        target: { roomCode: "ROOM22", seat: 1, seatId: "A".repeat(22) },
        askerId: RIYA,
        refusal,
      }),
    ).rejects.toThrow("database down");
  });
});
