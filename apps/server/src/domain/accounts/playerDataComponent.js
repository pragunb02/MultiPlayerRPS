import { assertDefined, assertFunction } from "../../utils/assert.js";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Every deletion is erased once more this long after it was asked. That finishes a deletion the server could not
 * complete (a crash or a deploy halfway), and removes anything a game that was ending at that very moment wrote.
 */
export const SWEEP_AGAIN_AFTER_MS = 5 * MINUTE_MS;

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
 * Deletion asks for the password again, records the deletion first, closes the account, then lets each
 * participant erase what it holds, in the order the composition root lists them. Housekeeping sweeps each deletion
 * again a few minutes later.
 *
 * @param {{
 *   accountComponent: Pick<ReturnType<typeof import("./accountComponent.js").createAccountComponent>, "confirmPassword" | "close" | "profileOf">,
 *   accountDeletionAccessor: Pick<ReturnType<typeof import("../../data/accountDeletionAccessor.js").createAccountDeletionAccessor>, "record" | "listDue" | "markSwept">,
 *   participants: ReadonlyArray<PlayerDataParticipant>,
 * }} deps
 */
export function createPlayerDataComponent({ accountComponent, accountDeletionAccessor, participants }) {
  assertDefined(accountComponent, "accountComponent");
  assertDefined(accountDeletionAccessor, "accountDeletionAccessor");
  participants.forEach(({ name, erasePlayer }) => assertFunction(erasePlayer, `${name}.erasePlayer`));

  /** The account, then every participant in order. Stops at the first failure: the next sweep runs it all again. */
  async function eraseEverything({ playerId, now }) {
    await accountComponent.close({ playerId, now });
    const erased = {};
    for (const participant of participants) {
      Object.assign(erased, (await participant.erasePlayer({ playerId, now })).erased);
    }
    return erased;
  }

  return Object.freeze({
    /**
     * @param {{ playerId: string, password: unknown, now: number }} input
     * @returns {Promise<{ erased: Record<string, number> }>} what each store removed or anonymised
     * @throws {import("../../utils/errors.js").ValidationError} with `details.field` "password"
     */
    async deleteAccount({ playerId, password, now }) {
      await accountComponent.confirmPassword({ playerId, password });
      await accountDeletionAccessor.record({
        playerId,
        requestedAt: now,
        sweepAgainAt: now + SWEEP_AGAIN_AFTER_MS,
        expiresAt: now + DELETION_RECORD_KEPT_MS,
      });
      return { erased: await eraseEverything({ playerId, now }) };
    },

    /**
     * Housekeeping: erases each deletion whose second sweep is due once more. A sweep that fails stays due.
     *
     * @param {{ now: number }} input
     * @returns {Promise<{ completed: string[], failed: Array<{ playerId: string, error: unknown }> }>}
     */
    async sweepDue({ now }) {
      const completed = [];
      const failed = [];
      for (const { playerId } of await accountDeletionAccessor.listDue({ now, limit: SWEEP_BATCH })) {
        try {
          await eraseEverything({ playerId, now });
          await accountDeletionAccessor.markSwept(playerId);
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
