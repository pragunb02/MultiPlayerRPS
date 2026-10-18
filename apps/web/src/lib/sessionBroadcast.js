/** The BroadcastChannel every tab of this site listens on for session changes (ADR-033). */
export const SESSION_CHANNEL = "cc.session";

/**
 * The whole message. It says only that the session changed, never who the player is now: each tab asks the server
 * for that, so no tab can take an identity from another one (ADR-033).
 */
const CHANGED = "changed";

/**
 * Tells the other tabs of this browser that this tab changed who the browser is (signed up, logged in, logged out
 * or started a guest), and hears when another tab did (CC-115). It writes nothing to web storage (CC-103), and a
 * tab never hears its own message.
 *
 * A browser without BroadcastChannel gets one that does nothing. Its tabs with a realtime connection still recover,
 * because the server ends their sockets (CC-234).
 *
 * @param {{ Channel: typeof BroadcastChannel | undefined }} deps   the browser's BroadcastChannel, if it has one
 * @returns {Readonly<{
 *   announce: () => void,
 *   onChange: (handler: () => void) => () => void,
 *   close: () => void,
 * }>}   `onChange` returns an unsubscribe
 */
export function createSessionBroadcast({ Channel }) {
  if (Channel === undefined) {
    return Object.freeze({
      announce: () => undefined,
      onChange: () => () => undefined,
      close: () => undefined,
    });
  }
  const channel = new Channel(SESSION_CHANNEL);
  return Object.freeze({
    announce: () => channel.postMessage(CHANGED),
    onChange(handler) {
      const listener = (event) => {
        if (event.data === CHANGED) handler();
      };
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    close: () => channel.close(),
  });
}
