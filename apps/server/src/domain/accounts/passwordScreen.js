import { PASSWORD_REFUSALS } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { NO_OPERATIONS_METRICS, PASSWORD_CHECK_OUTCOMES } from "../../utils/operationsMetrics.js";

/**
 * The one answer for a password attackers already know, whichever source knew it. It says what to do and does not
 * name the service or the list, so a refusal reads like the other password messages (CC-261).
 */
export const EASY_PASSWORD = "That password is too easy to guess. Choose a different one.";

/**
 * Refuses a new password that attackers already know (CC-261, ADR-080), at sign-up and on a password change.
 *
 * 1. The bundled common password list is checked first. It needs no network, and a password on it is refused
 *    without asking anyone else.
 * 2. Then Have I Been Pwned. When it fails or is late, the password is let through: the player is not stopped by
 *    a service we do not run, the local check has already run, and the outcome is counted so a long outage shows.
 *
 * Each check counts its outcome once, with nothing about the player or the password.
 *
 * @param {{
 *   breachedPasswords: Pick<ReturnType<typeof import("../../data/breachedPasswordAccessor.js").createBreachedPasswordAccessor>, "isCommon" | "isBreached">,
 *   recordCheck?: import("../../utils/operationsMetrics.js").OperationsMetrics["recordPasswordCheck"],
 * }} deps
 */
export function createPasswordScreen({
  breachedPasswords,
  recordCheck = NO_OPERATIONS_METRICS.recordPasswordCheck,
}) {
  assertDefined(breachedPasswords, "breachedPasswords");

  const refuse = (field) =>
    new ValidationError(EASY_PASSWORD, { details: { field, reason: PASSWORD_REFUSALS.EASY } });

  return Object.freeze({
    /**
     * @param {{ password: string, field: string }} input  a password that already passed `parsePassword`, and the
     *   form field a refusal is shown at
     * @returns {Promise<void>}
     * @throws {ValidationError} with `details.field` when the password is common or breached
     */
    async check({ password, field }) {
      if (breachedPasswords.isCommon(password)) {
        recordCheck({ outcome: PASSWORD_CHECK_OUTCOMES.COMMON });
        throw refuse(field);
      }
      let breached;
      try {
        breached = await breachedPasswords.isBreached(password);
      } catch {
        recordCheck({ outcome: PASSWORD_CHECK_OUTCOMES.UNAVAILABLE });
        return;
      }
      recordCheck({ outcome: breached ? PASSWORD_CHECK_OUTCOMES.BREACHED : PASSWORD_CHECK_OUTCOMES.CLEAR });
      if (breached) throw refuse(field);
    },
  });
}
