import { endpointOf } from "@classicade/shared";

/**
 * A usage counts facade for tests (CC-174) that records every `track` call, whatever the flag says, so a test can see
 * which events a page sends. It has the facade's whole shape.
 *
 * @returns {ReturnType<typeof import("../lib/telemetry/facade.js").createTelemetryFacade> & {
 *   tracked: Array<[string, object]>,
 *   named: (name: string) => object[],
 *   sent: { http: number, socket: number },
 * }}
 */
export function recordingTelemetry() {
  const tracked = [];
  const sent = { http: 0, socket: 0 };
  let context = { path: "/", playerKind: "visitor" };
  let landing = { entry: "direct", via: "" };
  const listeners = new Set();
  return {
    tracked,
    sent,
    named: (name) => tracked.filter(([event]) => event === name).map(([, fields]) => fields),
    // Fields given as a function are made at once, as the loaded client makes them (CC-322).
    track: (name, fields = {}) =>
      tracked.push([name, typeof fields === "function" ? fields({ endpointOf }) : fields]),
    setContext: (next) => {
      context = next;
    },
    context: () => context,
    noteRequest: (transport) => {
      sent[transport] += 1;
    },
    requestsSent: () => ({ ...sent }),
    attach: () => {},
    detach: () => {},
    isAttached: () => false,
    isOff: () => true,
    get landing() {
      return landing;
    },
    setLanding: (next) => {
      landing = next;
    },
    switched: () => listeners.forEach((listener) => listener()),
    onSwitched: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
