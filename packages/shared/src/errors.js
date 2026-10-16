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
  /** The thing existed but is gone for good, such as a closed room. The `details` say why (CC-101). */
  GONE: "GONE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  INTERNAL: "INTERNAL",
});
