import { BOTS, createBotRegistry, createEngineRegistry, ENGINES } from "@classicade/games";
import { createRoomAccessor } from "../data/roomAccessor.js";
import { createBotComponent } from "../domain/bots/botComponent.js";
import { createBotTurns } from "../domain/bots/botTurns.js";
import { createSealMaker } from "../domain/bots/seals.js";
import { createRoomComponent, ROOM_EVENTS } from "../domain/rooms/roomComponent.js";
import { createInMemoryRoomDao } from "./inMemoryRoomDao.js";

export const SEAL_SECRET = "seal-secret-for-tests-only-0123456789abcdef";
export const PERSON = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });

/**
 * Rooms with the real engines, bots and computer player rules over the in-memory room store. Codes are ROOM22,
 * ROOM33 and so on, and seeds count up from 1, so every test is exact.
 *
 * @param {{ seed?: number, onChange?: (room: object) => void }} [options]  the first game's seed, and who hears of
 *   every saved change (the bot driver, as the composition root wires it)
 */
export function botRooms({ seed = 1, onChange = () => {} } = {}) {
  const engines = createEngineRegistry(ENGINES);
  const bots = createBotRegistry(BOTS);
  const botTurns = createBotTurns({ bots, engines, sealMaker: createSealMaker({ secret: SEAL_SECRET }) });
  const roomAccessor = createRoomAccessor({ roomDao: createInMemoryRoomDao() });
  const changes = [];
  const published = [];
  const codes = ["ROOM22", "ROOM33", "ROOM44", "ROOM55", "ROOM66", "ROOM77"];
  let nextSeed = seed;
  let matchNumber = 0;
  const rooms = createRoomComponent({
    roomAccessor,
    engines,
    events: {
      emit(event, payload) {
        (event === ROOM_EVENTS.CHANGED ? changes : published).push({ event, payload });
        if (event === ROOM_EVENTS.CHANGED) onChange(payload.room);
      },
    },
    generateCode: () => codes.shift(),
    generateSeed: () => nextSeed++,
    generateMatchId: () => `m${++matchNumber}`,
    botTurns,
  });
  const botComponent = createBotComponent({ roomComponent: rooms });
  /** A started game against the game's character at `level`. */
  const playComputer = ({ gameId, level = "easy", options = {}, now = 1_000 }) =>
    botComponent.playComputer({ host: PERSON, gameId, options, level, now });
  return { engines, bots, botTurns, roomAccessor, rooms, botComponent, playComputer, changes, published };
}
