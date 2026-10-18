import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ConflictError } from "../../utils/errors.js";

/** A transfer still pending this long after it started was interrupted (crash, failed step): housekeeping resumes it. */
export const RESUME_AFTER_MS = 30_000;
const RESUME_BATCH = 20;

/**
 * @typedef {{ xp: number, matchesPlayed: number, matches: number }} CarriedOver   what moved to the account
 * @typedef {{
 *   name: string,
 *   transferPlayer: (transfer: { from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number })
 *     => Promise<{ moved: Readonly<Record<string, number>> }>,
 * }} TransferParticipant   a component that stores data by player id (ADR-014): it moves `from`'s data to `to`,
 *   merging into what `to` already has — idempotent and resumable
 */

const sum = (totals, moved) =>
  Object.fromEntries(
    [...new Set([...Object.keys(totals), ...Object.keys(moved)])].map((key) => [
      key,
      (totals[key] ?? 0) + (moved[key] ?? 0),
    ]),
  );

/**
 * A guest's data follows them to the account they sign up for or log in to (CC-032, ADR-014): progress totals,
 * match history, and whatever else a participant stores by player id.
 *
 * A transfer is recorded first (one per guest), then each participant moves its part, in order, then the record is
 * marked done. Every step is idempotent, so a transfer interrupted at any point is simply run again — by
 * `resumePending` — and nothing moves twice.
 *
 * @param {{
 *   playerTransferAccessor: ReturnType<typeof import("../../data/playerTransferAccessor.js").createPlayerTransferAccessor>,
 *   participants: ReadonlyArray<TransferParticipant>,
 *   matches: { transferPlayer: TransferParticipant["transferPlayer"], getById: (matchId: string) => Promise<Readonly<import("../../data/matchAccessor.js").Match>> },
 * }} deps
 */
export function createPlayerTransferComponent({ playerTransferAccessor, participants, matches }) {
  assertDefined(playerTransferAccessor, "playerTransferAccessor");
  assertDefined(participants, "participants");
  participants.forEach(({ name, transferPlayer }) =>
    assertFunction(transferPlayer, `${name}.transferPlayer`),
  );
  assertDefined(matches, "matches");

  /** @returns {Promise<CarriedOver>} */
  async function run({ from, to }, now) {
    const results = [];
    for (const participant of participants) {
      results.push(await participant.transferPlayer({ from, to, now }));
    }
    const moved = results.reduce((totals, result) => sum(totals, result.moved), {});
    const carriedOver = Object.freeze({
      xp: moved.xp ?? 0,
      matchesPlayed: moved.matchesPlayed ?? 0,
      matches: moved.matches ?? 0,
    });
    await playerTransferAccessor.markDone({ from, at: now, carriedOver });
    return carriedOver;
  }

  return Object.freeze({
    /**
     * Moves a guest's data to the account they just became. Repeating it (the same request twice, a retry)
     * moves nothing more.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ carriedOver?: Readonly<CarriedOver> }>} `carriedOver` only when something moved now
     * @throws {ConflictError} when this guest already moved to a different account
     */
    async transfer({ from, to, now }) {
      const { created, transfer } = await playerTransferAccessor.start({ from, to, at: now });
      if (transfer.to.id !== to.id) {
        throw new ConflictError("This guest already moved to another account");
      }
      if (!created && transfer.status === "done") {
        return {};
      }
      const carriedOver = await run(transfer, now);
      return Object.values(carriedOver).some((value) => value > 0) ? { carriedOver } : {};
    },

    /**
     * Finishes transfers that were interrupted (still pending `RESUME_AFTER_MS` after they started). One that
     * fails again stays pending for the next run.
     *
     * @param {{ now: number }} at
     * @returns {Promise<{ completed: string[], failed: Array<{ from: string, error: unknown }> }>}
     */
    async resumePending({ now }) {
      const pending = await playerTransferAccessor.listPending({
        createdBefore: now - RESUME_AFTER_MS,
        limit: RESUME_BATCH,
      });
      const outcomes = await Promise.allSettled(pending.map((transfer) => run(transfer, now)));
      return {
        completed: pending.filter((_, i) => outcomes[i].status === "fulfilled").map((t) => t.from),
        failed: pending.flatMap((transfer, i) => {
          const outcome = outcomes[i];
          return outcome.status === "rejected" ? [{ from: transfer.from, error: outcome.reason }] : [];
        }),
      };
    },

    /**
     * A match that finished while one of its players was signing in may have been recorded under the guest's id
     * after their history moved. Moves it too, and returns the match as stored now — so progression and
     * everything after it credit the account.
     *
     * @param {{ match: Readonly<import("../../data/matchAccessor.js").Match>, now: number }} recorded
     * @returns {Promise<Readonly<import("../../data/matchAccessor.js").Match>>}
     */
    async follow({ match, now }) {
      const playerIds = match.players.map((p) => p.playerId);
      const transfers = (await playerTransferAccessor.listFrom(playerIds)).filter(
        (transfer) => !playerIds.includes(transfer.to.id),
      );
      if (transfers.length === 0) {
        return match;
      }
      for (const { from, to } of transfers) {
        await matches.transferPlayer({ from, to, now });
      }
      return matches.getById(match.matchId);
    },

    /**
     * The guests whose data moved into this account, for its data export (CC-035).
     *
     * @param {{ playerId: string }} query  the account's player id
     */
    exportPlayer: async ({ playerId }) =>
      (await playerTransferAccessor.listTo(playerId)).map(
        ({ from, status, createdAt, completedAt, carriedOver }) => ({
          guest: from,
          status,
          startedAt: new Date(createdAt).toISOString(),
          ...(completedAt !== undefined && { completedAt: new Date(completedAt).toISOString() }),
          ...(carriedOver !== undefined && { carriedOver: { ...carriedOver } }),
        }),
      ),

    /**
     * Deletes the records of guests who moved into this account (CC-035). They name the account and its username.
     *
     * @param {{ playerId: string }} input  the account's player id
     * @returns {Promise<{ erased: { transfers: number } }>}
     */
    erasePlayer: async ({ playerId }) => ({
      erased: { transfers: await playerTransferAccessor.removeTo(playerId) },
    }),

    /**
     * The guest ids whose data moved into this account (CC-035): the ids the player played under before signing up.
     *
     * @param {{ playerId: string }} query  the account's player id
     * @returns {Promise<string[]>}
     */
    guestsOf: async ({ playerId }) => (await playerTransferAccessor.listTo(playerId)).map(({ from }) => from),
  });
}
