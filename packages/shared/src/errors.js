/**
 * Error codes returned by the API (`{ error: { code } }`) and socket acknowledgements.
 * Clients switch on these, never on messages — messages are for humans and may change.
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: "VALIDATION_FAILED",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
});
