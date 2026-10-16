import { IDENTITY_KINDS } from "@classicade/shared";
import { ValidationError } from "../utils/errors.js";

const ID_PATTERNS = Object.freeze({
  [IDENTITY_KINDS.GUEST]: /^guest_[0-9a-f-]{36}$/,
  [IDENTITY_KINDS.USER]: /^user_[0-9a-f]{24}$/,
});
const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;

/**
 * Who is playing. The only source of truth is the server-side session — never client input.
 *
 * @typedef {Object} Identity
 * @property {"guest" | "user"} kind
 * @property {string} id           stable player id, prefixed by kind (`guest_…`, `user_…`)
 * @property {string} displayName
 */

/**
 * Creates a validated, immutable identity.
 *
 * @param {{ kind: string, id: string, displayName: string }} fields
 * @returns {Readonly<Identity>}
 * @throws {ValidationError} when any field breaks the identity rules
 */
export function createIdentity({ kind, id, displayName }) {
  const idPattern = ID_PATTERNS[kind];
  if (idPattern === undefined) {
    throw new ValidationError("Unknown identity kind", { details: { field: "kind" } });
  }
  if (typeof id !== "string" || !idPattern.test(id)) {
    throw new ValidationError("Invalid player id", { details: { field: "id" } });
  }
  if (typeof displayName !== "string" || !DISPLAY_NAME_PATTERN.test(displayName)) {
    throw new ValidationError("Invalid display name", { details: { field: "displayName" } });
  }
  return Object.freeze({ kind: /** @type {Identity["kind"]} */ (kind), id, displayName });
}

/**
 * Whether a player id belongs to an account (not a guest). Leaderboards list accounts only (CC-053).
 *
 * @param {string} id
 */
export const isAccountId = (id) => ID_PATTERNS[IDENTITY_KINDS.USER].test(id);
