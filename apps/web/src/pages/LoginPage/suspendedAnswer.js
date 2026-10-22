import { ERROR_CODES, SUSPENDED_REASON } from "@classicade/shared";
import { AppRequestError } from "../../lib/errors.js";

/**
 * Whether a failed login is the answer a suspended account gets after the right password (CC-334, ADR-078).
 *
 * @param {unknown} err
 */
export const isSuspendedAnswer = (err) =>
  err instanceof AppRequestError &&
  err.code === ERROR_CODES.FORBIDDEN &&
  err.details?.reason === SUSPENDED_REASON;
