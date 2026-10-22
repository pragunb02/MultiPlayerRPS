import { ValidationError } from "../utils/errors.js";
import { EASY_PASSWORD } from "../domain/accounts/passwordScreen.js";

/** A password screen that lets every password through, for tests about something else (CC-261). */
export const ACCEPT_EVERY_PASSWORD = Object.freeze({ check: async () => undefined });

/**
 * A password screen that refuses the given passwords the way the real one does, and keeps every password it was
 * asked about, so a test can see whether and when the screen was used.
 *
 * @param {ReadonlyArray<string>} refused
 */
export function refusingPasswords(refused) {
  const asked = [];
  return {
    asked,
    check: async ({ password, field }) => {
      asked.push(password);
      if (refused.includes(password)) {
        throw new ValidationError(EASY_PASSWORD, { details: { field } });
      }
    },
  };
}
