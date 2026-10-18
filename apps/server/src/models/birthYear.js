import { BIRTH_YEAR_CHOICES } from "@classicade/shared";
import { ValidationError } from "../utils/errors.js";

/**
 * A birth year as the sign-up form offers it: a whole year from this year back to the oldest one in the list. One
 * year older is accepted too, because the browser may still be in the old year while India is already in the new one.
 *
 * @param {unknown} value
 * @param {{ currentYear: number }} context  this year in India
 * @returns {number}
 * @throws {ValidationError} with `details.field` "birthYear"
 */
export function parseBirthYear(value, { currentYear }) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value > currentYear ||
    value < currentYear - BIRTH_YEAR_CHOICES
  ) {
    throw new ValidationError("Choose your year of birth from the list", { details: { field: "birthYear" } });
  }
  return value;
}
