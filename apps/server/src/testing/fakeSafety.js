import { createSafetyComponent } from "../domain/safety/safetyComponent.js";

/**
 * The real safety component (CC-152) over a fake list of adults, for tests of the features that read the age
 * policy. `adultsAmong` answers which of the accounts it is asked about are adults; every other account is of
 * unknown age, so a minor. Guests and computer players get their own policies without asking, as in production.
 *
 * @param {(query: { playerIds: string[], now: number }) => Promise<Iterable<string>> | Iterable<string>} adultsAmong
 */
export function safetyFromAdults(adultsAmong) {
  return createSafetyComponent({
    ages: {
      ageGroupsOf: async ({ playerIds, now }) => {
        const adults = new Set(await adultsAmong({ playerIds, now }));
        return new Map(playerIds.map((playerId) => [playerId, adults.has(playerId) ? "adult" : "unknown"]));
      },
    },
  });
}

/** The safety component with no adults at all: everyone gets a minor's policy. */
export const safetyWithNoAdults = () => safetyFromAdults(() => []);
