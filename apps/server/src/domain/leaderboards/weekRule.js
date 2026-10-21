import { assertFunction } from "../../utils/assert.js";
import { INDIA_WEEK_OFFSET_MS } from "./isoWeek.js";

/**
 * The weekly boards' clock (CC-146, ADR-015 amended, ADR-077.6): Monday 00:00 UTC until `local_days` is on for
 * everyone, then Monday 00:00 India time. Once switched it stays switched in this process, so an owner's rollback or
 * stale overrides cannot move a week that has started back to the one before. Asking counts no flag exposure.
 *
 * @param {{ flags: Pick<ReturnType<typeof import("../flags/flagComponent.js").createFlagComponent>, "isFullyOn"> }} deps
 * @returns {() => Promise<number>} the offset from UTC of the week's clock, in ms
 */
export function createWeekRule({ flags }) {
  assertFunction(flags?.isFullyOn, "flags.isFullyOn");
  let india = false;
  return async () => {
    india = india || flags.isFullyOn("local_days");
    return india ? INDIA_WEEK_OFFSET_MS : 0;
  };
}
