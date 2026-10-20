import { randomUUID } from "node:crypto";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { NotFoundError } from "../../utils/errors.js";
import { createPlayerReferences } from "../players/playerReferences.js";

/** How many blocks one player keeps. Blocking one more drops the oldest (ADR-053, as Lichess does). */
export const MAX_BLOCKS_PER_PLAYER = 500;

/**
 * The one answer for every reference the server cannot confirm, so the block route cannot be used to find out
 * whether a room, a match, a report or a player exists (OWASP IDOR).
 */
const notPlayedWith = (cause) =>
  new NotFoundError("You can only block someone you played with", cause === undefined ? {} : { cause });

/** What a client sees of a block: never the blocked player's id. */
const viewOf = (block) =>
  Object.freeze({ blockId: block.blockId, displayName: block.blockedName, blockedAt: block.createdAt });

/**
 * @typedef {import("../players/playerReferences.js").PlayedWith | { reportId: string }} BlockTarget   who to block,
 *   by a seat in an open room or among the players of a stored match (see playerReferences.js), or by a report the
 *   blocker made, so the thank-you after a report can block in one tap (ADR-071.4)
 */

/**
 * Blocks between players (CC-044, ADR-053). A block is silent and works both ways: the pair is never seated
 * together, never rematched and never paired, and the blocked player is never told. A player can block only someone
 * the server saw them play with: the other player of an open room both sit in, or of a match both played, or someone
 * they reported (ADR-071).
 *
 * @param {{
 *   blockAccessor: ReturnType<typeof import("../../data/blockAccessor.js").createBlockAccessor>,
 *   rooms: Parameters<typeof createPlayerReferences>[0]["rooms"],
 *   matches: Parameters<typeof createPlayerReferences>[0]["matches"],
 *   transfers: Pick<ReturnType<typeof import("../../data/playerTransferAccessor.js").createPlayerTransferAccessor>, "listFrom" | "listTo">,
 *   seatIds: Parameters<typeof createPlayerReferences>[0]["seatIds"],
 *   reports?: { reportedBy: (query: { reportId: string, reporterId: string }) => Promise<import("../players/playerReferences.js").Person> },
 *   newBlockId?: () => string,
 *   limit?: number,
 * }} deps  `rooms` is the room accessor: the room component reads blocks itself, so it cannot be read here. A
 *   room that has closed is gone from it. `matches` is the match component, read for the real players of a match
 *   (CC-297). `transfers` are the guests who signed
 *   in: a block that names a guest after that guest became an account still applies to the account (ADR-014).
 *   `seatIds` are the seat ids the room views show (CC-253), the same ones the room component uses. `reports` finds
 *   who a player reported, by their own report's id. Without it a report id names nobody. `limit` is for tests only
 */
export function createBlockComponent({
  blockAccessor,
  rooms,
  matches,
  transfers,
  seatIds,
  reports,
  newBlockId = randomUUID,
  limit = MAX_BLOCKS_PER_PLAYER,
}) {
  assertDefined(blockAccessor, "blockAccessor");
  assertFunction(transfers?.listTo, "transfers.listTo");
  assertFunction(newBlockId, "newBlockId");
  if (reports !== undefined) assertFunction(reports.reportedBy, "reports.reportedBy");
  const references = createPlayerReferences({ rooms, matches, transfers, seatIds });
  const { accountsOf } = references;

  /** The person at `target`, once the server has checked that the blocker played with them there or reported them. */
  async function personAt(target, blockerId) {
    try {
      if ("reportId" in target) {
        if (reports === undefined) throw notPlayedWith();
        return await reports.reportedBy({ reportId: target.reportId, reporterId: blockerId });
      }
      return (await references.playedWith({ target, callerId: blockerId })).person;
    } catch (err) {
      if (err instanceof NotFoundError) throw notPlayedWith(err);
      throw err;
    }
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
      const person = await personAt(target, blocker.id);
      // The guest at the seat may have signed in since the seat was read, and their blocks have moved already. So
      // this one goes straight to the account (ADR-014).
      const blockedId = (await accountsOf([person.playerId]))(person.playerId);
      if (blockedId === blocker.id) throw notPlayedWith();
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
