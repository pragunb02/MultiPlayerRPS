import { ERROR_CODES } from "@classicade/shared";

/**
 * A failed request to the server (HTTP or socket), carrying the server's stable error `code`
 * (ERROR_CODES) so UI code can react to the kind of failure, never to message text.
 */
export class AppRequestError extends Error {
  /**
   * @param {{ code: string, message: string, details?: Record<string, unknown>, status?: number }} error
   */
  constructor({ code, message, details = {}, status = 0 }) {
    super(message);
    this.name = "AppRequestError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

/** For network failures (offline, server down): no response at all. */
export const networkError = (cause) =>
  Object.assign(
    new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade — check your connection" }),
    {
      cause,
    },
  );

export const isUnauthorized = (err) =>
  err instanceof AppRequestError && err.code === ERROR_CODES.UNAUTHORIZED;

/** Failures where the same request can work a moment later: no answer, a timeout, a server fault, too many tries. */
const RETRYABLE_CODES = new Set([
  "NETWORK",
  "TIMEOUT",
  "UNKNOWN",
  ERROR_CODES.INTERNAL,
  ERROR_CODES.RATE_LIMITED,
]);

/**
 * Whether a failed action is worth a Retry button (CC-164). A rule the server refused, such as a taken cell or a
 * wrong password, fails the same way every time. It gets an explanation and no Retry.
 *
 * @param {unknown} err  what the action threw
 */
export const isRetryable = (err) =>
  err instanceof AppRequestError && (RETRYABLE_CODES.has(err.code) || err.status >= 500);
