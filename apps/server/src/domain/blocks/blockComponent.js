import { randomUUID } from "node:crypto";
import { isBotPlayerId } from "../../models/botIdentity.js";
import { isDeletedPlayerId } from "../../models/deletedPlayer.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";

/** How many blocks one player keeps. Blocking one more drops the oldest (ADR-053, as Lichess does). */
export const MAX_BLOCKS_PER_PLAYER = 500;

/**
 * The one answer for every reference the server cannot confirm, so the block route cannot be used to find out
 * whether a room, a match or a player exists (OWASP IDOR).
 */
const notPlayedWith = (cause) =>
  new NotFoundError("You can only block someone you played with", cause === undefined ? {} : { cause });

/** A seat held by a person who could be blocked: not the blocker, not a computer, not a deleted player's stand-in. */
const isOtherPerson = (playerId, blockerId) =>
  playerId !== blockerId && !isBotPlayerId(playerId) && !isDeletedPlayerId(playerId);

/** What a client sees of a block: never the blocked player's id. */
const viewOf = (block) =>
  Object.freeze({ blockId: block.blockId, displayName: block.blockedName, blockedAt: block.createdAt });

/**
 * @typedef {{ roomCode: string, seat: number } | { matchId: string, seat: number }} BlockTarget   who to block, by
 *   a seat in an open room or among the players of a stored match. Never by a player id.
 */

/**
 * Blocks between players (CC-044, ADR-053). A block is silent and works both ways: the pair is never seated
 * together, never rematched and never paired, and the blocked player is never told. A player can block only someone
 * the server saw them play with: the other player of an open room both sit in, or of a match both played.
 *
 * @param {{
 *   blockAccessor: ReturnType<typeof import("../../data/blockAccessor.js").createBlockAccessor>,
 *   rooms: { getByCode: (code: string) => Promise<Readonly<{ seats: ReadonlyArray<{ playerId: string, displayName: string }> }>> },
 *   matches: { getForPlayer: (query: { matchId: string, playerId: string }) => Promise<Readonly<{ players: ReadonlyArray<{ playerId: string, displayName: string }> }>> },
 *   newBlockId?: () => string,
 *   limit?: number,
 * }} deps  `rooms` is the room accessor: the room component reads blocks itself, so it cannot be read here. A
 *   room that has closed is gone from it. `matches` is the match component. `limit` is for tests only
 */
export function createBlockComponent({
  blockAccessor,
  rooms,
  matches,
  newBlockId = randomUUID,
  limit = MAX_BLOCKS_PER_PLAYER,
}) {
  assertDefined(blockAccessor, "blockAccessor");
  assertFunction(rooms?.getByCode, "rooms.getByCode");
  assertFunction(matches?.getForPlayer, "matches.getForPlayer");
  assertFunction(newBlockId, "newBlockId");

  /** The people a reference points at: the seats of an open room or the players of a stored match. */
  async function playersOf(target, blockerId) {
    try {
      if ("roomCode" in target) {
        return (await rooms.getByCode(target.roomCode)).seats;
      }
      return (await matches.getForPlayer({ matchId: target.matchId, playerId: blockerId })).players;
    } catch (err) {
      // A closed room or a missing one is a stranger's room as far as the blocker is concerned.
      if (err instanceof NotFoundError || err instanceof GoneError) throw notPlayedWith(err);
      throw err;
    }
  }

  /** The person at `target`, once the server has checked that the blocker played with them there. */
  async function personAt(target, blockerId) {
    const players = await playersOf(target, blockerId);
    const person = players[target.seat];
    if (
      !players.some((player) => player.playerId === blockerId) ||
      person === undefined ||
      !isOtherPerson(person.playerId, blockerId)
    ) {
      throw notPlayedWith();
    }
    return person;
  }

  /** Every player on either side of a block with this one. */
  async function blockedWith({ playerId }) {
    const blocks = await blockAccessor.listInvolving(playerId);
    return new Set(blocks.map((block) => (block.blockerId === playerId ? block.blockedId : block.blockerId)));
  }

  return Object.freeze({
    /**
     * Blocks the person at `target`. Blocking them again changes nothing and answers the same block. Above the
     * limit the oldest block goes.
     *
     * @param {{ blocker: Readonly<import("../../models/identity.js").Identity>, target: BlockTarget, now: number }} input
     * @returns {Promise<Readonly<{ blockId: string, displayName: string, blockedAt: number }>>}
     * @throws {NotFoundError} for every reference the server cannot confirm, all with the same message
     */
    async block({ blocker, target, now }) {
      const person = await personAt(target, blocker.id);
      const { created, block } = await blockAccessor.add({
        blockId: newBlockId(),
        blockerId: blocker.id,
        blockedId: person.playerId,
        blockedName: person.displayName,
        at: now,
      });
      if (created) {
        await blockAccessor.keepNewest({ blockerId: blocker.id, keep: limit });
      }
      return viewOf(block);
    },

    /**
     * Removes one of the player's own blocks.
     *
     * @param {{ blockerId: string, blockId: string }} input
     * @throws {NotFoundError} when the player has no block with that id, whoever else might
     */
    async unblock({ blockerId, blockId }) {
      if (!(await blockAccessor.remove({ blockerId, blockId }))) {
        throw new NotFoundError("No such block");
      }
    },

    /**
     * The blocks the player made, newest first. Never the blocks other players made on them.
     *
     * @param {{ blockerId: string }} query
     */
    listFor: async ({ blockerId }) => Object.freeze((await blockAccessor.listBy(blockerId)).map(viewOf)),

    /**
     * Every player on either side of a block with `playerId`: the ones they blocked and the ones who blocked them.
     * Rooms read it before they seat or rematch, and quick match (CC-051) must read it before it pairs.
     *
     * @param {{ playerId: string }} query
     * @returns {Promise<ReadonlySet<string>>}
     */
    blockedWith,

    /**
     * Whether either player blocked the other.
     *
     * @param {{ a: string, b: string }} pair
     */
    eitherBlocked: async ({ a, b }) => (await blockedWith({ playerId: a })).has(b),

    /**
     * A guest just signed in (ADR-014): the blocks they made become the account's, and the blocks others made on
     * them now name the account, so signing in never gets round a block. The blocker keeps seeing the name they
     * blocked, never the account's. Running it twice moves nothing more.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ moved: { blocks: number } }>}
     */
    async transferPlayer({ from, to }) {
      const made = await blockAccessor.moveBlocker({ from, to: to.id });
      const received = await blockAccessor.moveBlocked({ from, to: to.id });
      await blockAccessor.keepNewest({ blockerId: to.id, keep: limit });
      return { moved: { blocks: made + received } };
    },

    /**
     * The blocks the player made, for their data export (CC-035). The blocks on them are other players' data.
     *
     * @param {{ playerId: string }} query
     */
    exportPlayer: async ({ playerId }) =>
      (await blockAccessor.listBy(playerId)).map((block) => ({
        displayName: block.blockedName,
        blockedAt: new Date(block.createdAt).toISOString(),
      })),

    /**
     * Deletes every block on either side of the player (CC-035). Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { blocks: number } }>}
     */
    erasePlayer: async ({ playerId }) => ({
      erased: { blocks: await blockAccessor.removeInvolving(playerId) },
    }),
  });
}
