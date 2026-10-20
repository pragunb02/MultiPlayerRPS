import { assertDefined, assertFunction } from "../../utils/assert.js";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Every deletion is erased again this often after it was asked. That finishes a deletion the server could not
 * complete (a crash or a deploy halfway), and removes anything a game that was ending at that very moment wrote.
 */
export const SWEEP_AGAIN_AFTER_MS = 5 * MINUTE_MS;

/**
 * For how long after it was asked a deletion is swept again. A game that ended just before the deletion may still be
 * retried by the match pipeline for about 13 minutes (MATCH_RETRY_POLICY) and write under the player's id, so the
 * sweeps go on for longer than that.
 */
export const SWEEP_FOR_MS = 30 * MINUTE_MS;

/**
 * How long the record of a deletion is kept: as long as the backups (DATA.md). It names an id that leads nowhere
 * any more, and it is what the owner uses to delete those accounts again after restoring a backup.
 */
export const DELETION_RECORD_KEPT_MS = 30 * DAY_MS;

// Deletions swept again in one housekeeping run. More wait for the next minute.
const SWEEP_BATCH = 20;

/**
 * One kind of stored player data, as deletion and export see it (CC-035). `erasePlayer` deletes or anonymises
 * everything it holds for the player, and running it twice changes nothing. `exportPlayer`, when there is one,
 * answers the player's own data as plain JSON.
 *
 * @typedef {{
 *   name: string,
 *   erasePlayer: (input: { playerId: string, now: number }) => Promise<{ erased: Record<string, number> }>,
 *   exportPlayer?: (input: { playerId: string, now: number }) => Promise<unknown>,
 * }} PlayerDataParticipant
 */

/**
 * A player's right to leave and to take their data with them (CC-035): deleting an account, and exporting it.
 * Deletion asks for the password again, records the deletion first and closes the account (`closeAccount`). The
 * caller then cuts the player's connections, and each participant erases what it holds, in the order the composition
 * root lists them (`eraseAccount`). Housekeeping sweeps each deletion again every few minutes for half an hour.
 *
 * @param {{
 *   accountComponent: Pick<ReturnType<typeof import("./accountComponent.js").createAccountComponent>, "confirmPassword" | "close" | "profileOf">,
 *   accountDeletionAccessor: Pick<ReturnType<typeof import("../../data/accountDeletionAccessor.js").createAccountDeletionAccessor>, "record" | "listDue" | "markSwept" | "sweepAgainAt">,
 *   participants: ReadonlyArray<PlayerDataParticipant>,
 *   formerIdsOf: (query: { playerId: string }) => Promise<ReadonlyArray<string>>,  the guest ids the player had
 *     before signing up. Their data is erased too
 * }} deps
 */
export function createPlayerDataComponent({
  accountComponent,
  accountDeletionAccessor,
  participants,
  formerIdsOf,
}) {
  assertDefined(accountComponent, "accountComponent");
  assertDefined(accountDeletionAccessor, "accountDeletionAccessor");
  assertFunction(formerIdsOf, "formerIdsOf");
  participants.forEach(({ name, erasePlayer }) => assertFunction(erasePlayer, `${name}.erasePlayer`));

  /**
   * Every participant in order, under the account id and then under each guest id the player had: a game can be
   * stored under a guest id after its history moved to the account. Stops at the first failure: the next sweep
   * runs it all again.
   */
  async function eraseStores({ playerId, formerIds, now }) {
    const erased = {};
    for (const participant of participants) {
      for (const id of [playerId, ...formerIds]) {
        const { erased: counts } = await participant.erasePlayer({ playerId: id, now });
        for (const [name, count] of Object.entries(counts)) erased[name] = (erased[name] ?? 0) + count;
      }
    }
    return erased;
  }

  /**
   * @param {{ playerId: string, password: unknown, now: number }} input
   * @throws {import("../../utils/errors.js").ValidationError} with `details.field` "password"
   */
  async function closeAccount({ playerId, password, now }) {
    await accountComponent.confirmPassword({ playerId, password });
    // Worked out once, before the records that know them are erased, and kept for every later sweep.
    const formerIds = [...(await formerIdsOf({ playerId }))];
    await accountDeletionAccessor.record({
      playerId,
      requestedAt: now,
      sweepAgainAt: now + SWEEP_AGAIN_AFTER_MS,
      expiresAt: now + DELETION_RECORD_KEPT_MS,
      formerIds,
    });
    await accountComponent.close({ playerId, now });
    return { formerIds };
  }

  /** @param {{ playerId: string, formerIds: ReadonlyArray<string>, now: number }} input */
  const eraseAccount = async ({ playerId, formerIds, now }) => ({
    erased: await eraseStores({ playerId, formerIds, now }),
  });

  return Object.freeze({
    /**
     * Checks the password, records the deletion and deletes the account itself. From here on no session of the
     * account works, and the deletion is finished for sure: by `eraseAccount` now, or by the sweeps. Answers the
     * guest ids the player had, for `eraseAccount`.
     *
     * @returns {Promise<{ formerIds: string[] }>}
     */
    closeAccount,

    /**
     * Erases or anonymises everything every participant holds for the closed account.
     *
     * @returns {Promise<{ erased: Record<string, number> }>} what each store removed or anonymised
     */
    eraseAccount,

    /**
     * Both at once, for callers with no connections to cut in between.
     *
     * @param {{ playerId: string, password: unknown, now: number }} input
     * @returns {Promise<{ erased: Record<string, number> }>}
     */
    async deleteAccount({ playerId, password, now }) {
      const { formerIds } = await closeAccount({ playerId, password, now });
      return eraseAccount({ playerId, formerIds, now });
    },

    /**
     * Housekeeping: erases each deletion whose next sweep is due once more, and plans the next one until
     * `SWEEP_FOR_MS` after it was asked. A sweep that fails stays due.
     *
     * @param {{ now: number }} input
     * @returns {Promise<{ completed: string[], failed: Array<{ playerId: string, error: unknown }> }>}
     */
    async sweepDue({ now }) {
      const completed = [];
      const failed = [];
      for (const { playerId, requestedAt, formerIds } of await accountDeletionAccessor.listDue({
        now,
        limit: SWEEP_BATCH,
      })) {
        try {
          await accountComponent.close({ playerId, now });
          await eraseStores({ playerId, formerIds, now });
          if (now < requestedAt + SWEEP_FOR_MS) {
            await accountDeletionAccessor.sweepAgainAt({ playerId, at: now + SWEEP_AGAIN_AFTER_MS });
          } else {
            await accountDeletionAccessor.markSwept(playerId);
          }
          completed.push(playerId);
        } catch (error) {
          failed.push({ playerId, error });
        }
      }
      return { completed, failed };
    },

    /**
     * Everything the player can take with them, as plain JSON: the account, then each participant that exports.
     *
     * @param {{ playerId: string, password: unknown, now: number }} input
     * @throws {import("../../utils/errors.js").ValidationError} with `details.field` "password"
     */
    async exportFor({ playerId, password, now }) {
      const account = await accountComponent.confirmPassword({ playerId, password });
      const { ageGroup } = await accountComponent.profileOf({ playerId, now });
      const exported = {
        exportedAt: new Date(now).toISOString(),
        account: {
          username: account.username,
          email: account.email,
          createdAt: new Date(account.createdAt).toISOString(),
          ...(account.birthYear !== undefined && { birthYear: account.birthYear }),
          ...(account.birthYearCorrectedAt !== undefined && {
            birthYearCorrectedAt: account.birthYearCorrectedAt.toISOString(),
          }),
          ageGroup,
        },
      };
      for (const participant of participants.filter((p) => p.exportPlayer !== undefined)) {
        exported[participant.name] = await participant.exportPlayer({ playerId, now });
      }
      return exported;
    },
  });
}
