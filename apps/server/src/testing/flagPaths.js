import { describe } from "vitest";
import { flagNamed } from "@classicade/shared";

/**
 * Runs a suite once with a feature flag on and once with it off (CC-312, ADR-073). Every flag in the registry needs
 * one, so both of its paths are tested until the flag is removed. `flagNames.test.js` fails for a flag without it.
 *
 * @param {string} name  a flag in packages/shared/src/flags.js
 * @param {(on: boolean) => void} suite  the tests, told whether the flag is on
 */
export function flagPaths(name, suite) {
  flagNamed(name);
  describe.each([
    ["on", true],
    ["off", false],
  ])(`with the ${name} flag %s (CC-312)`, (_, on) => suite(on));
}
