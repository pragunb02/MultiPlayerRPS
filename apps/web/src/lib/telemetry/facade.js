/**
 * The small part of usage counts that is in the page from the start (CC-174). Code anywhere calls `track`, and the
 * facade holds the events in memory until the client, loaded after the first paint, takes them, or drops them all
 * when counts turn out to be off. It also counts requests, so the click watcher can tell a press that did something
 * from one that did nothing. Nothing here is kept beyond the page.
 *
 * @typedef {{ route: string, playerKind: string }} TelemetryContext   where the player is and who, never an id
 *
 * @typedef {Object} TelemetrySink   the loaded client (client.js)
 * @property {(name: string, fields?: object, context?: TelemetryContext) => void} track
 * @property {() => void} stop
 */

/** How many events wait at most for the client. A page that loads slowly loses the rest, never the page's speed. */
export const MAX_WAITING = 100;

const TRANSPORTS = Object.freeze(["http", "socket"]);

const NO_ENTRY = Object.freeze({ entry: "direct", via: "" });

/**
 * @param {{ isOff: () => boolean, landing?: Readonly<{ entry: string, via: string }> }} deps  `isOff` is the opt-out
 *   (optOut.js), checked before anything is held. `landing` is how this page load arrived (entry.js)
 */
export function createTelemetryFacade({ isOff, landing = NO_ENTRY }) {
  const listeners = new Set();
  let arrived = landing;
  /** @type {"waiting" | "on" | "off"} */
  let state = "waiting";
  /** @type {TelemetrySink | undefined} */
  let sink;
  /** @type {TelemetryContext} */
  // Until the app says which screen this is: the composition root sets it from the address before anything else.
  let context = { route: "not_found", playerKind: "visitor" };
  /** @type {Array<[string, object, TelemetryContext]>} */
  let waiting = [];
  const sent = { http: 0, socket: 0 };

  return Object.freeze({
    /**
     * Counts one event. Off, it does nothing. A name or field the catalogue does not have throws once the client
     * is loaded, in tests and development.
     *
     * @param {string} name
     * @param {Record<string, string | number | boolean>} [fields]
     */
    track(name, fields = {}) {
      if (state === "off" || isOff()) return;
      if (state === "on" && sink !== undefined) {
        sink.track(name, fields, context);
        return;
      }
      if (waiting.length < MAX_WAITING) waiting.push([name, fields, context]);
    },

    /** @param {TelemetryContext} next  the screen and the kind of player from now on */
    setContext(next) {
      context = Object.freeze({ ...next });
    },

    /** @returns {TelemetryContext} */
    context: () => context,

    /**
     * Notes a request the app sent, so a press followed by one is not a dead click.
     *
     * @param {"http" | "socket"} transport
     */
    noteRequest(transport) {
      if (TRANSPORTS.includes(transport)) sent[transport] += 1;
    },

    /** @returns {Readonly<{ http: number, socket: number }>} requests sent so far on this page */
    requestsSent: () => Object.freeze({ ...sent }),

    /**
     * The client is loaded and counts are on: it takes the waiting events, in order, with the screen each was on.
     *
     * @param {TelemetrySink} client
     */
    attach(client) {
      sink = client;
      state = "on";
      const held = waiting;
      waiting = [];
      held.forEach(([name, fields, at]) => client.track(name, fields, at));
    },

    /**
     * Counts are off for now (the flag is off for this player, or they switched counts off): the waiting events are
     * dropped and nothing more is held until a client is attached again.
     */
    detach() {
      state = "off";
      waiting = [];
      sink?.stop();
      sink = undefined;
    },

    /** Whether the client has taken over. */
    isAttached: () => state === "on",

    /** Whether nothing may be counted now (the switch, GPC, DNT, a test or a laptop). */
    isOff,

    /** How this page load arrived: the landing `entry` and, for a shared link, its channel. */
    get landing() {
      return arrived;
    },

    /** @param {Readonly<{ entry: string, via: string }>} next  how this page load arrived, once it is known */
    setLanding(next) {
      arrived = Object.freeze({ ...next });
    },

    /**
     * Tells whoever listens that the switch changed, so counts stop or start at once.
     */
    switched() {
      if (isOff()) {
        state = "off";
        waiting = [];
        sink?.stop();
        sink = undefined;
      }
      listeners.forEach((listener) => listener());
    },

    /**
     * @param {() => void} listener  told when the switch changed
     * @returns {() => void} stops telling it
     */
    onSwitched(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

/** A facade that counts nothing, for tests and pages that wire no telemetry. */
export const NO_TELEMETRY = createTelemetryFacade({ isOff: () => true });
