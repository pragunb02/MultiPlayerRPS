import { randomUUID } from "node:crypto";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError } from "../../utils/errors.js";
import { createCoPlayers } from "../players/coPlayers.js";

/** How many blocks one player keeps. Blocking one more drops the oldest (ADR-053, as Lichess does). */
export const MAX_BLOCKS_PER_PLAYER = 500;

/**
 * The one answer for every reference the server cannot confirm, so the block route cannot be used to find out
 * whether a room, a match or a player exists (OWASP IDOR).
 */
const notPlayedWith = (cause) =>
  new NotFoundError("You can only block someone you played with", cause === undefined ? {} : { cause });

/** What a client sees of a block: never the blocked player's id. */
const viewOf = (block) =>
  Object.freeze({ blockId: block.blockId, displayName: block.blockedName, blockedAt: block.createdAt });

/** @typedef {import("../players/coPlayers.js").PlayedWith} BlockTarget   who to block, as someone the blocker played with */

/**
 * Blocks between players (CC-044, ADR-053). A block is silent and works both ways: the pair is never seated
 * together, never rematched and never paired, and the blocked player is never told. A player can block only someone
 * the server saw them play with: the other player of an open room both sit in, or of a match both played.
 *
 * @param {{
 *   blockAccessor: ReturnType<typeof import("../../data/blockAccessor.js").createBlockAccessor>,
 *   rooms: { getByCode: (code: string) => Promise<Readonly<{ code: string, createdAt: number, seats: ReadonlyArray<{ playerId: string, displayName: string }> }>> },
 *   matches: { playersFor: (query: { matchId: string, playerId: string }) => Promise<ReadonlyArray<Readonly<{ playerId: string, displayName: string }>>> },
 *   transfers: Pick<ReturnType<typeof import("../../data/playerTransferAccessor.js").createPlayerTransferAccessor>, "listFrom" | "listTo">,
 *   seatIds: Pick<ReturnType<typeof import("../rooms/seatIds.js").createSeatIds>, "seatIdOf">,
 *   newBlockId?: () => string,
 *   limit?: number,
 *   followers?: ReadonlyArray<{ name: string, playersBlocked: (pair: { blockerId: string, blockedId: string }) => Promise<unknown> }>,
 * }} deps  `rooms` is the room accessor: the room component reads blocks itself, so it cannot be read here. A
 *   room that has closed is gone from it. `matches` is the match component, read for the real players of a match
 *   (CC-297). `transfers` are the guests who signed
 *   in: a block that names a guest after that guest became an account still applies to the account (ADR-014).
 *   `seatIds` are the seat ids the room views show (CC-253), the same ones the room component uses. `limit` is for
 *   tests only. `followers` are told of every block, a repeated one too, before the block answers: friends end the
 *   friendship there (CC-052), so a block never leaves the pair friends, even for a moment
 */
export function createBlockComponent({
  blockAccessor,
  rooms,
  matches,
  transfers,
  seatIds,
  newBlockId = randomUUID,
  limit = MAX_BLOCKS_PER_PLAYER,
  followers = [],
}) {
  assertDefined(blockAccessor, "blockAccessor");
  assertFunction(rooms?.getByCode, "rooms.getByCode");
  assertFunction(matches?.playersFor, "matches.playersFor");
  assertFunction(transfers?.listFrom, "transfers.listFrom");
  assertFunction(transfers?.listTo, "transfers.listTo");
  assertFunction(seatIds?.seatIdOf, "seatIds.seatIdOf");
  assertFunction(newBlockId, "newBlockId");
  followers.forEach((follower) => assertFunction(follower.playersBlocked, `${follower.name}.playersBlocked`));
  const coPlayers = createCoPlayers({ rooms, matches, transfers, seatIds });

  /** Each id as it is now: a guest who signed in is their account. Other ids stay as they are. */
  async function accountsOf(playerIds) {
    const moved = new Map(
      (await transfers.listFrom([...new Set(playerIds)])).map((transfer) => [transfer.from, transfer.to.id]),
    );
    return (id) => moved.get(id) ?? id;
  }

  /**
   * Who this player blocked, and who blocked them. A block stored under a guest id the player had, or under the
   * guest id of someone who has signed in since, counts for the account: a guest's blocks move when they sign in,
   * but one can land on the guest id just after (ADR-014).
   */
  async function relationsOf({ playerId }) {
    const ownIds = [playerId, ...(await transfers.listTo(playerId)).map((transfer) => transfer.from)];
    const blocks = (await Promise.all(ownIds.map((id) => blockAccessor.listInvolving(id)))).flat();
    const own = new Set(ownIds);
    const current = await accountsOf(blocks.flatMap((block) => [block.blockerId, block.blockedId]));
    const blocked = blocks
      .filter((block) => own.has(block.blockerId))
      .map((block) => current(block.blockedId));
    const blockedBy = blocks
      .filter((block) => own.has(block.blockedId))
      .map((block) => current(block.blockerId));
    // A guest who blocked the account they became is no block at all.
    const others = (ids) => new Set(ids.filter((id) => !own.has(id)));
    return Object.freeze({ blocked: others(blocked), blockedBy: others(blockedBy) });
  }

  /** Every player on either side of a block with this one. */
  async function blockedWith({ playerId }) {
    const { blocked, blockedBy } = await relationsOf({ playerId });
    return new Set([...blocked, ...blockedBy]);
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
      // A guest at the seat who signed in since is their account, so the block goes straight to it (ADR-014).
      const person = await coPlayers.personAt({ target, askerId: blocker.id, refusal: notPlayedWith });
      const blockedId = person.playerId;
      const { created, block } = await blockAccessor.add({
        blockId: newBlockId(),
        blockerId: blocker.id,
        blockedId,
        blockedName: person.displayName,
        at: now,
      });
      if (created) {
        await blockAccessor.keepNewest({ blockerId: blocker.id, keep: limit });
      }
      for (const follower of followers) {
        await follower.playersBlocked({ blockerId: blocker.id, blockedId });
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
     * Who the player blocked and who blocked them, apart. Rooms need the direction to answer a rematch between a
     * blocked pair as a person would: the blocker's yes becomes a no, and the blocked player finds the question
     * taken back (ADR-053).
     *
     * @param {{ playerId: string }} query
     * @returns {Promise<Readonly<{ blocked: ReadonlySet<string>, blockedBy: ReadonlySet<string> }>>}
     */
    relationsOf,

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
