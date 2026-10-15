/**
 * Socket.IO event names shared by server and web. Never use string literals for events.
 * Client → server events are acknowledged with `{ ok: true, data } | { ok: false, error: { code, message } }`.
 */
export const SOCKET_EVENTS = Object.freeze({
  /** client → server: returns the identity bound to this connection's session */
  IDENTITY_GET: "identity:get",
});
