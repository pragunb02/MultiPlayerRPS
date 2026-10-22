/**
 * The kinds of value a telemetry field may hold (CC-174, CC-175, ADR-034). Every field is one of these: a closed list,
 * a true or false, a whole number of milliseconds rounded to 10, or a pattern whose every match is a fixed string in
 * our code. Nothing typed by a person, no id and no address can be any of them. The catalogue (`events.js`) is made
 * of these, and the browser and the server check every event with the same rules.
 */

/** @typedef {{ kind: "list", values: ReadonlyArray<string | number>, optional: boolean }} ListField */
/** @typedef {{ kind: "flag", optional: boolean }} FlagField */
/** @typedef {{ kind: "ms", max: number, optional: boolean }} MsField */
/** @typedef {{ kind: "ratio", max: number, optional: boolean }} RatioField */
/** @typedef {{ kind: "pattern", pattern: RegExp, maxLength: number, optional: boolean }} PatternField */
/** @typedef {ListField | FlagField | MsField | RatioField | PatternField} Field */

/**
 * One of a closed list.
 *
 * @param {ReadonlyArray<string | number>} values
 * @returns {Readonly<ListField>}
 */
export const list = (values) =>
  Object.freeze({ kind: "list", values: Object.freeze([...values]), optional: false });

/** True or false. @returns {Readonly<FlagField>} */
export const flag = () => Object.freeze({ kind: "flag", optional: false });

/**
 * A time in whole milliseconds, rounded to 10 (EVENTS.md 1.5), from 0 to `max`.
 *
 * @param {number} max
 * @returns {Readonly<MsField>}
 */
export const ms = (max) => Object.freeze({ kind: "ms", max, optional: false });

/**
 * A number from 0 to `max` with at most two decimals, such as the layout shift score.
 *
 * @param {number} max
 * @returns {Readonly<RatioField>}
 */
export const ratio = (max) => Object.freeze({ kind: "ratio", max, optional: false });

/**
 * A name from our code that has too many values to list here, such as a control name. The pattern must allow only
 * fixed shapes: lowercase words, never digits that could hold a code or an id.
 *
 * @param {RegExp} pattern
 * @param {number} maxLength
 * @returns {Readonly<PatternField>}
 */
export const pattern = (pattern, maxLength) =>
  Object.freeze({ kind: "pattern", pattern, maxLength, optional: false });

/**
 * The same field, which an event may leave out.
 *
 * @template {Field} T
 * @param {T} field
 * @returns {Readonly<T>}
 */
export const optional = (field) => Object.freeze({ ...field, optional: true });

/**
 * Whether a value fits a field.
 *
 * @param {Readonly<Field>} field
 * @param {unknown} value
 * @returns {boolean}
 */
export function fits(field, value) {
  switch (field.kind) {
    case "list":
      return field.values.includes(/** @type {string} */ (value));
    case "flag":
      return value === true || value === false;
    case "ms":
      return (
        Number.isInteger(value) &&
        Number(value) >= 0 &&
        Number(value) <= field.max &&
        Number(value) % 10 === 0
      );
    case "ratio":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= field.max &&
        Math.round(value * 100) === value * 100
      );
    case "pattern":
      return typeof value === "string" && value.length <= field.maxLength && field.pattern.test(value);
    default:
      return false;
  }
}
