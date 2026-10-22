import { checkTelemetryEvent, isTelemetryBuild, TELEMETRY_SOURCES } from "@classicade/shared";

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * @typedef {Object} CheckedBatch
 * @property {string | undefined} build   the batch's build, or undefined when the batch was not usable at all
 * @property {ReadonlyArray<Readonly<Record<string, string | number | boolean>>>} events   the events that passed
 * @property {number} invalid   how many events were dropped, a whole broken batch counting as its events (at least 1)
 */

/**
 * Checks a batch from a browser against the shared catalogue (CC-175). The batch is `{ build, events }` and nothing
 * else. Each event is checked on its own: one that is not in the catalogue, has a key it does not allow or a value
 * outside its list is dropped and counted, and the rest are kept (owner, 2026-10-20). A batch with the wrong shape,
 * a build that is not one of ours, or more than `maxEvents` events is dropped whole.
 *
 * @param {unknown} body  the parsed JSON
 * @param {{ maxEvents: number }} limits
 * @returns {Readonly<CheckedBatch>}
 */
export function checkBatch(body, { maxEvents }) {
  const sent = isPlainObject(body) && Array.isArray(body.events) ? body.events.length : 0;
  const whole = Object.freeze({ build: undefined, events: Object.freeze([]), invalid: Math.max(1, sent) });
  const wellFormed =
    isPlainObject(body) &&
    Object.keys(body).every((key) => key === "build" || key === "events") &&
    isTelemetryBuild(body.build) &&
    Array.isArray(body.events) &&
    body.events.length <= maxEvents;
  if (!wellFormed) return whole;
  const checked = body.events.map((event) => checkTelemetryEvent(event, TELEMETRY_SOURCES.CLIENT));
  const events = checked.filter((result) => result.ok).map((result) => result.event);
  return Object.freeze({ build: body.build, events: Object.freeze(events), invalid: sent - events.length });
}
