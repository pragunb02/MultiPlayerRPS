import { roundMs, TELEMETRY_MAX_WAIT_MS } from "@classicade/shared";

/** The page's speed is sent this long after it loaded, or earlier when it is hidden (EVENTS.md 3.1). */
export const PAGE_SPEED_AFTER_MS = 30_000;

const FIRST_CONTENTFUL_PAINT = "first-contentful-paint";

/**
 * Measures how fast this page load was, once (CC-174): time to first byte, first and largest contentful paint, the
 * slowest interaction (INP, the worst one, which is exact up to 50 interactions) and the layout shift score, each
 * from the browser's own timings. A measure the browser does not offer is left out.
 *
 * @param {{
 *   performance: Pick<Performance, "getEntriesByType">,
 *   PerformanceObserver: typeof PerformanceObserver | undefined,
 *   wasWaking: boolean,   the CC-232 waking up screen was on screen as the app started
 *   track: (name: string, fields: Record<string, number | boolean>) => void,
 *   setTimer: (run: () => void, ms: number) => unknown,
 *   clearTimer: (timer: unknown) => void,
 * }} deps
 * @returns {{ send: () => void, stop: () => void }} `send` sends now, if not sent yet (the page is being hidden)
 */
export function measurePageSpeed({
  performance,
  PerformanceObserver,
  wasWaking,
  track,
  setTimer,
  clearTimer,
}) {
  const seen = { fcp: undefined, lcp: undefined, inp: undefined, cls: 0 };
  let sent = false;
  const observers = [];
  const observe = (type, onEntries) => {
    if (PerformanceObserver === undefined || !PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    const observer = new PerformanceObserver((list) => onEntries(list.getEntries()));
    observer.observe({ type, buffered: true, ...(type === "event" && { durationThreshold: 40 }) });
    observers.push(observer);
  };
  observe("paint", (entries) => {
    const fcp = entries.find((entry) => entry.name === FIRST_CONTENTFUL_PAINT);
    if (fcp !== undefined) seen.fcp = fcp.startTime;
  });
  observe("largest-contentful-paint", (entries) => {
    seen.lcp = entries.at(-1)?.startTime ?? seen.lcp;
  });
  observe("event", (entries) =>
    entries
      .filter((entry) => /** @type {{ interactionId?: number }} */ (entry).interactionId)
      .forEach((entry) => {
        seen.inp = Math.max(seen.inp ?? 0, entry.duration);
      }),
  );
  observe("layout-shift", (entries) =>
    entries
      .filter((entry) => !(/** @type {{ hadRecentInput?: boolean }} */ (entry).hadRecentInput))
      .forEach((entry) => {
        seen.cls += /** @type {{ value?: number }} */ (entry).value ?? 0;
      }),
  );

  const timing = (value) => (value === undefined ? {} : roundMs(value, TELEMETRY_MAX_WAIT_MS));
  function send() {
    if (sent) return;
    sent = true;
    clearTimer(timer);
    observers.forEach((observer) => observer.disconnect());
    const [navigation] = performance.getEntriesByType("navigation");
    const fields = {
      ttfb_ms: timing(/** @type {{ responseStart?: number }} */ (navigation)?.responseStart),
      fcp_ms: timing(seen.fcp),
      lcp_ms: timing(seen.lcp),
      inp_ms: timing(seen.inp),
      cls: Math.min(100, Math.round(seen.cls * 100) / 100),
      was_waking: wasWaking,
    };
    track(
      "page_speed_measured",
      Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value !== "object")),
    );
  }
  const timer = setTimer(send, PAGE_SPEED_AFTER_MS);

  return Object.freeze({
    send,
    stop() {
      sent = true;
      clearTimer(timer);
      observers.forEach((observer) => observer.disconnect());
    },
  });
}
