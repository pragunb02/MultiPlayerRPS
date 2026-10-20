import { ERROR_CODES, TELEMETRY_ERROR_TYPES, TELEMETRY_SOCKET_CODES } from "@classicade/shared";

/**
 * What an error may tell usage counts (CC-174, EVENTS.md 3.5): its kind from fixed lists, never its message, its
 * stack or anything it carries.
 */

const KNOWN_CODES = new Set(Object.values(ERROR_CODES));

/**
 * The constructor name of an error when it is on the list, otherwise `other`. Anything thrown that is not an error
 * (a string, an object) is `other` too, so a message can never be sent as a name.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function errorTypeOf(error) {
  const name = error instanceof Error ? error.constructor?.name : undefined;
  return typeof name === "string" && TELEMETRY_ERROR_TYPES.includes(name) ? name : "other";
}

/**
 * An error's code as the catalogue names it: one of ERROR_CODES, or `timeout`, `network` or `unknown`.
 *
 * @param {unknown} error  usually an AppRequestError
 * @returns {string}
 */
export function codeOf(error) {
  const code = /** @type {{ code?: unknown }} */ (error)?.code;
  if (typeof code === "string" && KNOWN_CODES.has(code)) return code;
  if (code === "TIMEOUT") return "timeout";
  return code === "NETWORK" || code === "NETWORK_ERROR" ? "network" : "unknown";
}

/** Socket.IO's disconnect reasons, as the catalogue names them. */
const DISCONNECT_REASONS = Object.freeze({
  "io server disconnect": "server_disconnect",
  "io client disconnect": "client_disconnect",
  "ping timeout": "ping_timeout",
  "transport close": "transport_close",
  "transport error": "transport_error",
  "parse error": "parse_error",
});

/**
 * Why the realtime connection dropped or was refused, from a fixed list.
 *
 * @param {unknown} reason  a Socket.IO disconnect reason, or a connect error with `data.code`
 * @returns {string} a TELEMETRY_SOCKET_CODES value
 */
export function socketCodeOf(reason) {
  if (typeof reason === "string") return DISCONNECT_REASONS[reason] ?? "other";
  const code = /** @type {{ data?: { code?: unknown } }} */ (reason)?.data?.code;
  if (typeof code === "string" && TELEMETRY_SOCKET_CODES.includes(code)) return code;
  return "connect_error";
}

/**
 * What the error boundary is told for usage counts: a render error, by its type only, never its message or stack.
 *
 * @param {{ track: (name: string, fields: Record<string, string>) => void }} telemetry
 * @returns {(error: unknown) => void}
 */
export const countRenderErrors = (telemetry) => (error) =>
  telemetry.track("client_errored", { kind: "render", error_type: errorTypeOf(error) });
