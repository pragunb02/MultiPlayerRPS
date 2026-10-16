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
