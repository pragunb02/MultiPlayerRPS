import { isBotPlayerId } from "../../models/botIdentity.js";
import { isDeletedPlayerId } from "../../models/deletedPlayer.js";
import { assertFunction } from "../../utils/assert.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";

/**
 * @typedef {{ roomCode: string, seat: number, seatId: string }} RoomSeat   a seat of an open room, by its place and
 *   the seat id the room view showed for it (CC-253). Seats move (a player leaves, another joins, a rematch swaps
 *   them), so the reference holds only while that seat still holds that person
 * @typedef {{ matchId: string, seat: number }} MatchSeat   a player of a stored match, by their place among the
 *   match's players, which never move
 * @typedef {RoomSeat | MatchSeat} PlayedWith
 * @typedef {Readonly<{ playerId: string, displayName: string }>} Person   who a reference points at, as the server
 *   knows them now: a guest who signed in since is their account (ADR-014)
 * @typedef {Readonly<{ kind: "room", room: Readonly<import("../../data/roomAccessor.js").Room> } | { kind: "match", matchId: string }>} Place
 *   where the two met
 */

/** The one error for every reference the server cannot confirm. Each caller answers it in its own words. */
const unknownReference = (cause) => new NotFoundError("No such player", cause === undefined ? {} : { cause });

/** A seat held by someone another player can act on: not the caller, not a computer, not a deleted stand-in. */
const isOtherPerson = (playerId, callerId) =>
  playerId !== callerId && !isBotPlayerId(playerId) && !isDeletedPlayerId(playerId);

/**
 * Who the client means when it names another player by where they met, never by a player id (OWASP IDOR, CC-044).
 * Blocks (ADR-053) and reports (ADR-071) read people through it, so both accept exactly the same references and
 * refuse exactly the same ones.
 *
 * @param {{
 *   rooms: { getByCode: (code: string) => Promise<Readonly<import("../../data/roomAccessor.js").Room>> },
 *   matches: { playersFor: (query: { matchId: string, playerId: string }) => Promise<ReadonlyArray<Readonly<{ playerId: string, displayName: string }>>> },
 *   transfers: Pick<ReturnType<typeof import("../../data/playerTransferAccessor.js").createPlayerTransferAccessor>, "listFrom">,
 *   seatIds: Pick<ReturnType<typeof import("../rooms/seatIds.js").createSeatIds>, "seatIdOf">,
 * }} deps  `rooms` is the room accessor (a closed room is gone from it), `matches` the match component's server-only
 *   read of a match's real players (CC-297), `transfers` the guests who signed in, `seatIds` the room views' seat ids
 */
export function createPlayerReferences({ rooms, matches, transfers, seatIds }) {
  assertFunction(rooms?.getByCode, "rooms.getByCode");
  assertFunction(matches?.playersFor, "matches.playersFor");
  assertFunction(transfers?.listFrom, "transfers.listFrom");
  assertFunction(seatIds?.seatIdOf, "seatIds.seatIdOf");

  /** Each id as it is now: a guest who signed in is their account. Other ids stay as they are. */
  async function accountsOf(playerIds) {
    const moved = new Map(
      (await transfers.listFrom([...new Set(playerIds)])).map((transfer) => [transfer.from, transfer.to.id]),
    );
    return (id) => moved.get(id) ?? id;
  }

  /** The people at a place, and the place. A room seat also answers the seat id its room view shows. */
  async function playersOf(target, callerId) {
    try {
      if ("roomCode" in target) {
        const room = await rooms.getByCode(target.roomCode);
        const players = room.seats.map((seat) => ({
          ...seat,
          seatId: seatIds.seatIdOf(room, seat.playerId),
        }));
        return { players, place: Object.freeze({ kind: "room", room }) };
      }
      const players = await matches.playersFor({ matchId: target.matchId, playerId: callerId });
      return { players, place: Object.freeze({ kind: "match", matchId: target.matchId }) };
    } catch (err) {
      // A closed room or a missing one is a stranger's room as far as the caller is concerned.
      if (err instanceof NotFoundError || err instanceof GoneError) throw unknownReference(err);
      throw err;
    }
  }

  return Object.freeze({
    /**
     * The person at `target`, once the server has checked that the caller sat in that room or played that match
     * with them, and where they met.
     *
     * @param {{ target: PlayedWith, callerId: string }} query
     * @returns {Promise<Readonly<{ person: Person, place: Place }>>}
     * @throws {NotFoundError} for every reference the server cannot confirm, all alike
     */
    async playedWith({ target, callerId }) {
      const { players, place } = await playersOf(target, callerId);
      const seated = players[target.seat];
      if (
        !players.some((player) => player.playerId === callerId) ||
        seated === undefined ||
        ("seatId" in target && seated.seatId !== target.seatId) ||
        !isOtherPerson(seated.playerId, callerId)
      ) {
        throw unknownReference();
      }
      // The guest in the seat may have signed in since the seat was read. What is done to them goes straight to the
      // account (ADR-014).
      const playerId = (await accountsOf([seated.playerId]))(seated.playerId);
      if (playerId === callerId) throw unknownReference();
      return Object.freeze({
        person: Object.freeze({ playerId, displayName: seated.displayName }),
        place,
      });
    },

    /**
     * Each id as it is now, for callers that keep ids of their own: a guest who signed in is their account.
     *
     * @param {ReadonlyArray<string>} playerIds
     * @returns {Promise<(playerId: string) => string>}
     */
    accountsOf,
  });
}
