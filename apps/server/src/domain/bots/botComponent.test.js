import { describe, expect, it } from "vitest";
import { BOTS, createBotRegistry } from "@classicade/games";
import { GAME_IDS } from "@classicade/shared";
import { botRooms, NETWORK, PERSON } from "../../testing/botRooms.js";
import { GoneError, ValidationError } from "../../utils/errors.js";
import { ROOM_EVENTS } from "../rooms/roomComponent.js";
import { assertCharactersPlayable, createBotComponent, MAX_COMPUTER_GAMES } from "./botComponent.js";

const FRIEND = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });

describe("botComponent.playComputer", () => {
  it.each([
    [GAME_IDS.RPS, "bot_rocky_easy", "Rocky"],
    [GAME_IDS.TIC_TAC_TOE, "bot_pip_easy", "Pip"],
    [GAME_IDS.CHESS, "bot_queen-vee_easy", "Queen Vee"],
  ])("starts %s at once against its character, seated as a computer player", async (gameId, id, name) => {
    const { playComputer, rooms } = botRooms();

    const room = await playComputer({ gameId });

    expect(room.status).toBe("playing");
    expect(room.hostId).toBe(PERSON.id);
    expect(rooms.viewFor(room, PERSON.id).seats).toEqual([
      { playerId: PERSON.id, displayName: "Alice", connected: true },
      {
        playerId: id,
        displayName: name,
        connected: true,
        bot: { character: id.split("_")[1], level: "easy" },
      },
    ]);
  });

  it("keeps the game's options", async () => {
    const { playComputer } = botRooms();

    const room = await playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 5 } });

    expect(room.options).toEqual({ bestOf: 5 });
  });

  it("refuses an unknown level before any room is made", async () => {
    const { playComputer, roomAccessor } = botRooms();

    await expect(playComputer({ gameId: GAME_IDS.RPS, level: "impossible" })).rejects.toThrow(
      ValidationError,
    );
    expect(await roomAccessor.listAll()).toEqual([]);
  });

  it("refuses invalid options like any new room", async () => {
    const { playComputer } = botRooms();

    await expect(playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 4 } })).rejects.toThrow(
      ValidationError,
    );
  });

  describe(`at most ${MAX_COMPUTER_GAMES} games against computers at once`, () => {
    const playing = async (roomAccessor) =>
      (await roomAccessor.listBySeat(PERSON.id))
        .filter((room) => room.status === "playing")
        .map((r) => r.code);

    it("ends the oldest game when one more starts, and tells any tab still showing it", async () => {
      const { playComputer, roomAccessor, published } = botRooms();
      for (let i = 0; i < MAX_COMPUTER_GAMES; i++) {
        await playComputer({ gameId: GAME_IDS.RPS, now: 1_000 + i });
      }

      await playComputer({ gameId: GAME_IDS.TIC_TAC_TOE, now: 2_000 });

      expect(await playing(roomAccessor)).toEqual(["ROOM33", "ROOM44", "ROOM55"]);
      const ended = published.filter((p) => p.event === ROOM_EVENTS.UPDATED).map((p) => p.payload.room);
      expect(ended.map((room) => [room.code, room.status, room.result.reason])).toEqual([
        ["ROOM22", "finished", "forfeit"],
      ]);
    });

    it("leaves games between people alone", async () => {
      const { playComputer, rooms, roomAccessor } = botRooms();
      const withFriend = await rooms.createRoom({
        host: PERSON,
        network: NETWORK,
        gameId: GAME_IDS.RPS,
        options: {},
        now: 1,
      });
      await rooms.joinRoom({ code: withFriend.code, player: FRIEND, now: 2 });
      for (let i = 0; i <= MAX_COMPUTER_GAMES; i++) {
        await playComputer({ gameId: GAME_IDS.RPS, now: 10 + i });
      }

      expect(await playing(roomAccessor)).toContain(withFriend.code);
    });

    it("keeps to the limit when many games are asked for at the same moment, as from many tabs", async () => {
      const { playComputer, roomAccessor } = botRooms();

      const started = await Promise.all(
        Array.from({ length: 6 }, (_, i) => playComputer({ gameId: GAME_IDS.RPS, now: 1_000 + i })),
      );

      expect(started.map((room) => room.status)).toEqual(Array(6).fill("playing"));
      expect(await playing(roomAccessor)).toHaveLength(MAX_COMPUTER_GAMES);
    });

    /** A one round game against Rocky that the person wins, so a rematch is on offer. */
    async function finishedGame({ rooms, playComputer }) {
      const room = await playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 1 }, now: 500 });
      const [seal] = room.game.seals;
      const rocky = JSON.parse(seal.text);
      await rooms.makeMove({ code: room.code, playerId: seal.playerId, move: rocky, now: 501 });
      const beat = { rock: "paper", paper: "scissors", scissors: "rock" }[rocky.choice];
      const over = await rooms.makeMove({
        code: room.code,
        playerId: PERSON.id,
        move: { choice: beat },
        now: 502,
      });
      expect(over.status).toBe("finished");
      return { code: room.code, rocky: seal.playerId };
    }

    it("ends the oldest game when the computer accepts a rematch, so a rematch never goes past the limit", async () => {
      const setup = botRooms();
      const { code, rocky } = await finishedGame(setup);
      for (let i = 0; i < MAX_COMPUTER_GAMES; i++) {
        await setup.playComputer({ gameId: GAME_IDS.RPS, now: 1_000 + i });
      }
      await setup.rooms.requestRematch({ code, playerId: PERSON.id, now: 2_000 });

      const rematch = await setup.botComponent.acceptRematch({ code, playerId: rocky, now: 2_001 });

      expect(rematch.status).toBe("playing");
      expect(await playing(setup.roomAccessor)).toHaveLength(MAX_COMPUTER_GAMES);
      expect(await playing(setup.roomAccessor)).toContain(code);
      expect((await setup.rooms.getRoom("ROOM33")).status).toBe("finished");
    });

    it("ends nothing when the computer's answer starts no game", async () => {
      const setup = botRooms();
      const { code, rocky } = await finishedGame(setup);
      for (let i = 0; i < MAX_COMPUTER_GAMES; i++) {
        await setup.playComputer({ gameId: GAME_IDS.RPS, now: 1_000 + i });
      }

      // The person did not ask, so the computer's yes only waits for theirs.
      const room = await setup.botComponent.acceptRematch({ code, playerId: rocky, now: 2_001 });

      expect(room.status).toBe("finished");
      expect(await playing(setup.roomAccessor)).toHaveLength(MAX_COMPUTER_GAMES);
    });

    /** A bot component whose room component leaves rooms as `leaveRoom` says. */
    async function withLeave(leaveRoom) {
      const base = botRooms();
      for (let i = 0; i < MAX_COMPUTER_GAMES; i++) {
        await base.playComputer({ gameId: GAME_IDS.RPS, now: 1_000 + i });
      }
      const published = [];
      const component = createBotComponent({
        roomComponent: { ...base.rooms, leaveRoom },
        roomAccessor: base.roomAccessor,
        events: { emit: (event, payload) => published.push({ event, payload }) },
      });
      const play = () =>
        component.playComputer({
          host: PERSON,
          network: NETWORK,
          gameId: GAME_IDS.RPS,
          options: {},
          level: "easy",
          now: 3_000,
        });
      return { play, published };
    }

    it("goes on when an old game closed meanwhile", async () => {
      const gone = await withLeave(async () => {
        throw new GoneError("This room has closed");
      });
      const closed = await withLeave(async () => ({ closed: true }));

      expect((await gone.play()).status).toBe("playing");
      expect((await closed.play()).status).toBe("playing");
      expect(closed.published.filter((p) => p.event === ROOM_EVENTS.UPDATED)).toEqual([]);
    });

    it("passes other failures on", async () => {
      const failing = await withLeave(async () => {
        throw new Error("database down");
      });

      await expect(failing.play()).rejects.toThrow("database down");
    });
  });

  it("needs the room component, the room accessor and the events", () => {
    const { rooms, roomAccessor } = botRooms();
    const events = { emit() {} };

    expect(() => createBotComponent({ roomAccessor, events })).toThrow(TypeError);
    expect(() => createBotComponent({ roomComponent: rooms, events })).toThrow(TypeError);
    expect(() => createBotComponent({ roomComponent: rooms, roomAccessor })).toThrow(TypeError);
  });
});

describe("assertCharactersPlayable", () => {
  const bots = createBotRegistry(BOTS);

  it("accepts the catalog's characters", () => {
    expect(() => assertCharactersPlayable(bots)).not.toThrow();
  });

  it("names a character whose game has no bot, and a level its bot does not have", () => {
    const characters = [
      { id: "ludo-lu", gameId: "ludo", levels: [] },
      { id: "rocky", gameId: GAME_IDS.RPS, levels: [{ id: "hard", botLevel: "psychic" }] },
    ];

    expect(() => assertCharactersPlayable(bots, characters)).toThrow(
      "Computer characters that cannot play: ludo-lu plays ludo, which has no bot, rocky hard names the unknown bot level psychic",
    );
  });
});
