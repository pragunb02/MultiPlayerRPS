import {
  CLIENT_COMMON_FIELDS,
  SERVER_COMMON_FIELDS,
  TELEMETRY_EVENTS,
  TELEMETRY_SOURCES,
} from "../telemetry/events.js";

/**
 * Test helpers for the telemetry catalogue (CC-174, CC-175): a valid value for any field, and a valid event of any
 * name, made from the catalogue itself, so tests cover every event and field without listing them by hand.
 */

/**
 * A value that fits a field.
 *
 * @param {Readonly<import("../telemetry/fields.js").Field>} field
 * @returns {string | number | boolean}
 */
export function exampleValue(field) {
  switch (field.kind) {
    case "list":
      return field.values[0];
    case "flag":
      return true;
    case "ms":
      return 120;
    case "ratio":
      return 0.05;
    case "pattern":
      return "home.play_guest";
    default:
      throw new RangeError(`No example for a field of kind ${field.kind}`);
  }
}

/**
 * A valid event of a name: every common field, every required field of its own, and the first of each `oneOf` set.
 *
 * @param {string} name
 * @param {{ withOptional?: boolean }} [options]  also every optional field outside the `oneOf` sets
 * @returns {Record<string, string | number | boolean>}
 */
export function exampleTelemetryEvent(name, { withOptional = false } = {}) {
  const spec = TELEMETRY_EVENTS[name];
  const common = spec.by === TELEMETRY_SOURCES.CLIENT ? CLIENT_COMMON_FIELDS : SERVER_COMMON_FIELDS;
  const sets = spec.oneOf ?? [];
  const inSet = (key) => sets.some((set) => set.includes(key));
  const chosen = new Set(sets.map((set) => set[0]));
  const fields = Object.entries({ ...common, ...spec.fields }).filter(
    ([key, field]) => !field.optional || chosen.has(key) || (withOptional && !inSet(key)),
  );
  return { name, ...Object.fromEntries(fields.map(([key, field]) => [key, exampleValue(field)])) };
}
