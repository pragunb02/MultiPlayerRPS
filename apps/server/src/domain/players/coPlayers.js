import { isBotPlayerId } from "../../models/botIdentity.js";
import { isDeletedPlayerId } from "../../models/deletedPlayer.js";
import { assertFunction } from "../../utils/assert.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";

/**
 * @typedef {{ roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number }} PlayedWith   who,
 *   by a seat in an open room or among the players of a stored match. A room's seats move (a player leaves, another
 *   joins, a rematch swaps them), so a room seat also carries `seatId`, the seat id the room view showed for that
 *   seat (CC-253), and the person counts only while the seat still holds them. A match's players never move.
 *
 * @typedef {Object} CoPlayer   the other person, once the server checked the two played together
 * @property {string} playerId     who they are now: a guest who signed in since is their account (ADR-014)
 * @property {string} displayName  the name the seat showed
 * @property {boolean} [quickMatch]  whether they met in quick match (CC-051), which marks its rooms and matches.
 *   Left out for a stored match without the mark, which says nothing either way
 */

/** A seat held by a person: not the asker, not a computer, not a deleted player's stand-in. */
const isOtherPerson = (playerId, askerId) =>
  playerId !== askerId && !isBotPlayerId(playerId) && !isDeletedPlayerId(playerId);

/**
 * "Only people you played with" (ADR-053.3), for every feature that lets one player reach another they met: blocks
 * (CC-044) and friend requests (CC-052). The client names the other player by a room seat or a match seat, never by
 * a player id, and the server checks that both sat in that open room or played that stored match. Anything it
 * cannot confirm, including the asker themself, a computer character or a deleted player, gets the caller's one
 * refusal, so the answer never says whether a room, a match or a player exists (OWASP IDOR).
 *
 * @param {{
 *   rooms: { getByCode: (code: string) => Promise<Readonly<{ code: string, createdAt: number, quickMatch?: boolean, seats: ReadonlyArray<{ playerId: string, displayName: string }> }>> },
 *   matches: { meetingFor: (query: { matchId: string, playerId: string }) => Promise<Readonly<{ players: ReadonlyArray<Readonly<{ playerId: string, displayName: string }>>, quickMatch?: boolean }>> },
 *   transfers: Pick<ReturnType<typeof import("../../data/playerTransferAccessor.js").createPlayerTransferAccessor>, "listFrom">,
 *   seatIds: Pick<ReturnType<typeof import("../rooms/seatIds.js").createSeatIds>, "seatIdOf">,
 * }} deps  `rooms` is the room accessor (a room that closed is gone from it), `matches` the match component, read
 *   for the real players of a match (CC-297), `transfers` the guests who signed in, and `seatIds` the seat ids the
 *   room views show (CC-253)
 */
export function createCoPlayers({ rooms, matches, transfers, seatIds }) {
  assertFunction(rooms?.getByCode, "rooms.getByCode");
  assertFunction(matches?.meetingFor, "matches.meetingFor");
  assertFunction(transfers?.listFrom, "transfers.listFrom");
  assertFunction(seatIds?.seatIdOf, "seatIds.seatIdOf");

  /**
   * The people a reference points at: the seats of an open room or the players of a stored match. A room seat also
   * answers the seat id its room view shows, so the page's `seatId` can be checked against it.
   */
  async function playersOf(target, askerId, refusal) {
    try {
      if ("roomCode" in target) {
        const room = await rooms.getByCode(target.roomCode);
        return {
          quickMatch: room.quickMatch === true,
          players: room.seats.map((seat) => ({ ...seat, seatId: seatIds.seatIdOf(room, seat.playerId) })),
        };
      }
      return await matches.meetingFor({ matchId: target.matchId, playerId: askerId });
    } catch (err) {
      // A closed room or a missing one is a stranger's room as far as the asker is concerned.
      if (err instanceof NotFoundError || err instanceof GoneError) throw refusal(err);
      throw err;
    }
  }

  return Object.freeze({
    /**
     * The person at `target`, once the server has checked that the asker played with them there.
     *
     * @param {{ target: PlayedWith, askerId: string, refusal: (cause?: Error) => Error }} query  `refusal` makes the
     *   one error every reference the server cannot confirm gets
     * @returns {Promise<Readonly<CoPlayer>>}
     */
    async personAt({ target, askerId, refusal }) {
      const { players, quickMatch } = await playersOf(target, askerId, refusal);
      const person = players[target.seat];
      if (
        !players.some((player) => player.playerId === askerId) ||
        person === undefined ||
        ("seatId" in target && person.seatId !== target.seatId) ||
        !isOtherPerson(person.playerId, askerId)
      ) {
        throw refusal();
      }
      // The guest at the seat may have signed in since the seat was read, and their data has moved already. So the
      // answer is the account (ADR-014).
      const [transfer] = await transfers.listFrom([person.playerId]);
      const playerId = transfer === undefined ? person.playerId : transfer.to.id;
      if (playerId === askerId) throw refusal();
      return Object.freeze({
        playerId,
        displayName: person.displayName,
        ...(quickMatch !== undefined && { quickMatch }),
      });
    },
  });
}
