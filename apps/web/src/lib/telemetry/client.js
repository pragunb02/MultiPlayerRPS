import {
  checkTelemetryEvent,
  DEVICE_WIDTHS,
  TELEMETRY_DEVICES,
  TELEMETRY_SOURCES,
  telemetryEventNamed,
} from "@classicade/shared";

/**
 * When a batch goes (owner, 2026-10-20): every 10 seconds or at 20 events, and on `pagehide` by `sendBeacon`. A
 * batch that fails is tried once more after 5 seconds, then dropped. The server takes at most 30 a batch.
 */
export const TELEMETRY_BATCH = Object.freeze({
  maxEvents: 20,
  everyMs: 10_000,
  retryAfterMs: 5_000,
  serverMaxEvents: 30,
});

/** Where batches go, on our own server only. */
export const TELEMETRY_URL = "/api/telemetry";

/**
 * The width class of a viewport, never more precise than that.
 *
 * @param {number} width  CSS pixels
 * @returns {string} a TELEMETRY_DEVICES value
 */
export function deviceOf(width) {
  if (width < DEVICE_WIDTHS.TABLET) return TELEMETRY_DEVICES.PHONE;
  return width < DEVICE_WIDTHS.DESKTOP ? TELEMETRY_DEVICES.TABLET : TELEMETRY_DEVICES.DESKTOP;
}

/**
 * The telemetry client (CC-174, ADR-034): turns `track` calls into catalogue events and sends them in batches to
 * our own server. Each event gets only the common fields (the screen as a template, the width class, the kind of
 * player) and its own catalogue fields, and is checked against the shared catalogue before it is queued, so an id,
 * a code or a word a person typed can never be sent. The queue lives in memory only.
 *
 * @param {{
 *   build: string,   this page's build (CC-290)
 *   send: (body: string) => Promise<boolean>,   POSTs a batch, true when the server took it (204)
 *   beacon: (body: string) => boolean,   `navigator.sendBeacon`, for a page that is going away
 *   isOff: () => boolean,   the opt-out, checked again before every event
 *   viewportWidth: () => number,
 *   setTimer: (run: () => void, ms: number) => unknown,
 *   clearTimer: (timer: unknown) => void,
 *   strict: boolean,   throw on an event the catalogue does not allow (tests and development). Off in production,
 *     where such an event is dropped instead, so a mistake never breaks the page
 *   onAccepted?: () => void,   told once, the first time the server took a batch (the flag's success, CC-312)
 *   onBatchAccepted?: (events: ReadonlyArray<Readonly<Record<string, string | number | boolean>>>) => void,  told of
 *     each batch the server took, with its events (the flags' successes, review of #162)
 * }} deps
 */
export function createTelemetryClient({
  build,
  send,
  beacon,
  isOff,
  viewportWidth,
  setTimer,
  clearTimer,
  strict,
  onAccepted = () => undefined,
  onBatchAccepted = () => undefined,
}) {
  /** @type {Array<Readonly<Record<string, string | number | boolean>>>} */
  let queue = [];
  let timer;
  let accepted = false;
  let stopped = false;

  const bodyOf = (events) => JSON.stringify({ build, events });

  function accept() {
    if (accepted) return;
    accepted = true;
    onAccepted();
  }

  /** Sends a batch, and once more after a while if it fails. A second failure drops it. */
  function deliver(events, triesLeft = 1) {
    const body = bodyOf(events);
    send(body).then(
      (ok) => {
        if (ok) {
          accept();
          onBatchAccepted(events);
        } else if (triesLeft > 0)
          setTimer(() => deliver(events, triesLeft - 1), TELEMETRY_BATCH.retryAfterMs);
      },
      () => {
        if (triesLeft > 0) setTimer(() => deliver(events, triesLeft - 1), TELEMETRY_BATCH.retryAfterMs);
      },
    );
  }

  function takeQueue() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    const taken = queue;
    queue = [];
    const batches = [];
    for (let start = 0; start < taken.length; start += TELEMETRY_BATCH.serverMaxEvents) {
      batches.push(taken.slice(start, start + TELEMETRY_BATCH.serverMaxEvents));
    }
    return batches;
  }

  /** Sends what is queued now. */
  function flush() {
    takeQueue().forEach((events) => deliver(events));
  }

  return Object.freeze({
    /**
     * Queues one event.
     *
     * @param {string} name  an event of the catalogue sent by the browser
     * @param {Record<string, string | number | boolean>} [fields]  its own fields
     * @param {{ route: string, playerKind: string }} [context]  the screen and kind of player when it happened
     * @throws {RangeError} for an unknown name, and for fields the catalogue does not allow when `strict`
     */
    track(name, fields = {}, context = { route: "/", playerKind: "visitor" }) {
      const spec = telemetryEventNamed(name);
      if (stopped || isOff()) return;
      if (spec.by !== TELEMETRY_SOURCES.CLIENT) throw new RangeError(`"${name}" is sent by the server`);
      const checked = checkTelemetryEvent(
        {
          name,
          route: context.route,
          device: deviceOf(viewportWidth()),
          player_kind: context.playerKind,
          ...fields,
        },
        TELEMETRY_SOURCES.CLIENT,
      );
      if (!checked.ok) {
        if (strict) throw new RangeError(`Telemetry event "${name}" refused: ${checked.problem}`);
        return;
      }
      queue.push(checked.event);
      if (queue.length >= TELEMETRY_BATCH.maxEvents) flush();
      else timer ??= setTimer(flush, TELEMETRY_BATCH.everyMs);
    },

    flush,

    /** Sends what is queued by `sendBeacon`, for a page being hidden or left. A refused beacon is dropped. */
    flushNow() {
      takeQueue().forEach((events) => beacon(bodyOf(events)));
    },

    /** Stops for good: what is queued is dropped. */
    stop() {
      stopped = true;
      takeQueue();
    },
  });
}
