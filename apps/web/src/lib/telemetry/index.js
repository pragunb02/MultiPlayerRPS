import { bucketOf, TELEMETRY_BUCKETS } from "@classicade/shared";
import { watchClicks } from "./clicks.js";
import { createTelemetryClient, TELEMETRY_URL } from "./client.js";
import { errorTypeOf } from "./errorFields.js";
import { measurePageSpeed } from "./pageSpeed.js";

/** The lower ends of the `visit_ended` buckets after the first (EVENTS.md 3.1). */
const ACTIVE_EDGES_S = Object.freeze([10, 30, 60, 120, 300, 900, 1800]);
const PRESS_EDGES = Object.freeze([1, 6, 21]);

/**
 * Starts usage counts on this page (CC-174), the part loaded after the first paint: the client, the press watcher,
 * the page's speed, unhandled rejections and the end of the visit. The facade then hands it every event.
 *
 * @param {{
 *   window: Window,
 *   facade: ReturnType<typeof import("./facade.js").createTelemetryFacade>,
 *   isOff: () => boolean,
 *   build: string,
 *   strict: boolean,
 *   wasWaking: boolean,
 *   onAccepted: () => void,
 *   onBatchAccepted?: (events: ReadonlyArray<{ name: string }>) => void,
 *   surfaceOf?: (element: Element) => string | undefined,
 * }} deps
 * @returns {{ stop: () => void }}
 */
export function startTelemetry({
  window,
  facade,
  isOff,
  build,
  strict,
  wasWaking,
  onAccepted,
  onBatchAccepted,
  surfaceOf,
}) {
  const { document } = window;
  const setTimer = (run, ms) => window.setTimeout(run, ms);
  const clearTimer = (timer) => window.clearTimeout(/** @type {number} */ (timer));
  const client = createTelemetryClient({
    build,
    isOff,
    strict,
    onAccepted,
    ...(onBatchAccepted && { onBatchAccepted }),
    setTimer,
    clearTimer,
    viewportWidth: () => window.innerWidth,
    send: async (body) => {
      const res = await window.fetch(TELEMETRY_URL, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body,
      });
      return res.status === 204;
    },
    beacon: (body) => window.navigator.sendBeacon?.(TELEMETRY_URL, body) ?? false,
  });
  const track = (name, fields) => facade.track(name, fields);
  const clicks = watchClicks({
    document,
    view: window,
    track,
    requestsSent: facade.requestsSent,
    MutationObserver: window.MutationObserver,
    now: () => window.performance.now(),
    setTimer,
    clearTimer,
    ...(surfaceOf && { surfaceOf }),
  });
  const speed = measurePageSpeed({
    performance: window.performance,
    PerformanceObserver: window.PerformanceObserver,
    wasWaking,
    track,
    setTimer,
    clearTimer,
  });

  // Visible time only: a tab left in the background is not time on the site.
  let activeMs = 0;
  let visibleSince = document.visibilityState === "visible" ? window.performance.now() : undefined;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (visibleSince !== undefined) activeMs += window.performance.now() - visibleSince;
      visibleSince = undefined;
      speed.send();
      client.flushNow();
    } else {
      visibleSince = window.performance.now();
    }
  };
  /** @param {PageTransitionEvent} event */
  const onPageHide = (event) => {
    speed.send();
    // A page kept in the back and forward cache may come back, so its visit has not ended.
    if (!event.persisted) {
      const active = activeMs + (visibleSince === undefined ? 0 : window.performance.now() - visibleSince);
      track("visit_ended", {
        active_s: bucketOf(active / 1000, ACTIVE_EDGES_S, TELEMETRY_BUCKETS.ACTIVE_S),
        presses: bucketOf(clicks.presses(), PRESS_EDGES, TELEMETRY_BUCKETS.VISIT_PRESSES),
      });
    }
    client.flushNow();
  };
  /** @param {PromiseRejectionEvent} event */
  const onRejection = (event) =>
    track("client_errored", { kind: "unhandled", error_type: errorTypeOf(event.reason) });

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("unhandledrejection", onRejection);
  facade.attach(client);

  return Object.freeze({
    stop() {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("unhandledrejection", onRejection);
      clicks.stop();
      speed.stop();
      facade.detach();
    },
  });
}
