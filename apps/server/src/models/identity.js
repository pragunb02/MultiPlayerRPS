import { IDENTITY_KINDS } from "@classicade/shared";
import { ValidationError } from "../utils/errors.js";
import { PLAYER_ID_PATTERNS } from "./playerIdShape.js";

export { ACCOUNT_ID_PREFIX, GUEST_ID_PREFIX } from "./playerIdShape.js";

// A person signs in as a guest or an account only. Computer players and stand-ins are never an identity here.
const ID_PATTERNS = Object.freeze({
  [IDENTITY_KINDS.GUEST]: PLAYER_ID_PATTERNS[IDENTITY_KINDS.GUEST],
  [IDENTITY_KINDS.USER]: PLAYER_ID_PATTERNS[IDENTITY_KINDS.USER],
});
const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;

/** The letters a guest's name is drawn from. No 0/O or 1/I, so names are easy to read out loud to a friend. */
export const GUEST_NAME_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** How many letters follow `Guest-` in a guest's name. */
export const GUEST_NAME_SUFFIX_LENGTH = 4;
const SERVER_GIVEN_GUEST_NAME = new RegExp(`^Guest-[${GUEST_NAME_ALPHABET}]{${GUEST_NAME_SUFFIX_LENGTH}}$`);

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

/**
 * Whether a player id belongs to a guest.
 *
 * @param {string} id
 */
export const isGuestId = (id) => ID_PATTERNS[IDENTITY_KINDS.GUEST].test(id);

/**
 * Whether a name has exactly the shape the server gives guests (`Guest-` and four letters of the alphabet). Such a
 * name was not chosen by the player and says nothing about them, so the boards may show it at any age. Any other
 * name is treated as chosen, and the age rule applies to it (ADR-060).
 *
 * @param {string} name
 */
export const isServerGivenGuestName = (name) => SERVER_GIVEN_GUEST_NAME.test(name);
