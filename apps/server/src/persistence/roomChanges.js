import { isDeepStrictEqual } from "node:util";

/**
 * A MongoDB update that turns one stored room into the next by writing only what changed (CC-182). Unchanged parts
 * of a room are not sent at all, a move added to the end of a list is appended, and a field that is gone is
 * removed. Comparing is cheap because a new room reuses the unchanged parts of the room it was made from, so most
 * parts are the very same object and are skipped without looking inside.
 *
 * @param {Record<string, unknown>} previous   the room as it is stored now
 * @param {Record<string, unknown>} next       the room as it should be stored
 * @returns {{ $set?: Record<string, unknown>, $unset?: Record<string, "">, $push?: Record<string, { $each: unknown[] }> }}
 *   nothing at all when the rooms are the same
 */
export function roomChanges(previous, next) {
  const changes = { $set: {}, $unset: {}, $push: {} };
  compareObjects(previous, next, "", changes);
  return Object.fromEntries(Object.entries(changes).filter(([, fields]) => Object.keys(fields).length > 0));
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

// MongoDB reads a dot in a field path as a step into a nested field, and a leading dollar sign as an operator. An
// object with such a key is written whole instead of field by field.
const isPathSafe = (key) => key !== "" && !key.includes(".") && !key.startsWith("$");

/** Same value, checking whether it is the same object first because that is the common case. */
const same = (a, b) => a === b || isDeepStrictEqual(a, b);

function compare(before, after, path, changes) {
  if (before === after) {
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    compareObjects(before, after, path, changes);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    compareArrays(before, after, path, changes);
    return;
  }
  if (!same(before, after)) {
    changes.$set[path] = after;
  }
}

function compareObjects(before, after, prefix, changes) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (!keys.every(isPathSafe)) {
    if (!same(before, after)) {
      changes.$set[prefix] = after;
    }
    return;
  }
  for (const key of keys) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    // The collection leaves out undefined fields, so a field set to undefined is a field that is gone.
    if (after[key] === undefined) {
      if (before[key] !== undefined) {
        changes.$unset[path] = "";
      }
    } else if (before[key] === undefined) {
      changes.$set[path] = after[key];
    } else {
      compare(before[key], after[key], path, changes);
    }
  }
}

function compareArrays(before, after, path, changes) {
  // A hole in a list cannot be written as a single item, so such a list is written whole.
  if (before.includes(undefined) || after.includes(undefined)) {
    if (!same(before, after)) {
      changes.$set[path] = after;
    }
    return;
  }
  if (after.length === before.length) {
    after.forEach((item, index) => compare(before[index], item, `${path}.${index}`, changes));
    return;
  }
  // A list that only grew at the end, like a game's move log, gets the new items appended.
  if (after.length > before.length && before.every((item, index) => same(item, after[index]))) {
    changes.$push[path] = { $each: after.slice(before.length) };
    return;
  }
  changes.$set[path] = after;
}
