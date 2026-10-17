import { describe, expect, it } from "vitest";
import { roomChanges } from "./roomChanges.js";

const room = () => ({
  status: "playing",
  seats: [
    { playerId: "a", connected: true },
    { playerId: "b", connected: false },
  ],
  game: { log: [{ at: 1 }], state: { score: { a: 0, b: 0 } } },
});

describe("roomChanges", () => {
  it("writes nothing when nothing changed, even in new objects", () => {
    const before = room();

    expect(roomChanges(before, before)).toEqual({});
    expect(roomChanges(before, room())).toEqual({});
  });

  it("writes only the changed fields, by their path", () => {
    const before = room();
    const after = {
      ...before,
      status: "finished",
      seats: [before.seats[0], { ...before.seats[1], connected: true }],
    };

    expect(roomChanges(before, after)).toEqual({ $set: { status: "finished", "seats.1.connected": true } });
  });

  it("appends what was added to the end of a list", () => {
    const before = room();
    const after = { ...before, game: { ...before.game, log: [...before.game.log, { at: 2 }, { at: 3 }] } };

    expect(roomChanges(before, after)).toEqual({ $push: { "game.log": { $each: [{ at: 2 }, { at: 3 }] } } });
  });

  it("writes a list whole when it shrank or an earlier item changed", () => {
    const before = room();
    const shorter = { ...before, seats: [before.seats[0]] };
    const rewritten = { ...before, game: { ...before.game, log: [{ at: 9 }, { at: 2 }] } };

    expect(roomChanges(before, shorter)).toEqual({ $set: { seats: [before.seats[0]] } });
    expect(roomChanges(before, rewritten)).toEqual({ $set: { "game.log": [{ at: 9 }, { at: 2 }] } });
  });

  it("removes fields that are gone or undefined, and adds new ones", () => {
    const { game, ...before } = room();
    const withGame = { ...before, game, result: { winners: ["a"] } };

    expect(roomChanges(withGame, { ...before, result: undefined })).toEqual({
      $unset: { game: "", result: "" },
    });
    expect(roomChanges(before, withGame)).toEqual({ $set: { game, result: { winners: ["a"] } } });
    expect(roomChanges({ ...before, extra: undefined }, before)).toEqual({});
  });

  it("writes a value whole when its kind changed", () => {
    const before = room();

    expect(roomChanges(before, { ...before, seats: {} })).toEqual({ $set: { seats: {} } });
    expect(roomChanges(before, { ...before, status: { phase: 1 } })).toEqual({
      $set: { status: { phase: 1 } },
    });
  });

  it("writes an object whole when one of its keys cannot be named in a database path", () => {
    const before = { score: { "a.b": 1, c: 1 } };

    expect(roomChanges(before, { score: { "a.b": 2, c: 1 } })).toEqual({
      $set: { score: { "a.b": 2, c: 1 } },
    });
    expect(roomChanges(before, { score: { "a.b": 1, c: 1 } })).toEqual({});
    expect(roomChanges({ score: {} }, { score: { $x: 1 } })).toEqual({ $set: { score: { $x: 1 } } });
    expect(roomChanges({ score: { "": 1 } }, { score: {} })).toEqual({ $set: { score: {} } });
  });

  it("writes a list with a hole in it whole", () => {
    expect(roomChanges({ list: [1, undefined] }, { list: [1, undefined, 3] })).toEqual({
      $set: { list: [1, undefined, 3] },
    });
    expect(roomChanges({ list: [1, 2] }, { list: [1, undefined] })).toEqual({
      $set: { list: [1, undefined] },
    });
    expect(roomChanges({ list: [1, undefined] }, { list: [1, undefined] })).toEqual({});
  });
});
