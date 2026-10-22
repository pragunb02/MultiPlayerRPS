import { SHARED_LINK_ENTRY, TELEMETRY_ENTRIES } from "@classicade/shared";

/** Search engines and social sites by host, checked against the referrer's host only (EVENTS.md 3.1). */
const SEARCH =
  /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.[a-z.]+|yandex\.[a-z.]+|ecosia\.org|baidu\.com)$/;
const SOCIAL =
  /(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|reddit\.com|linkedin\.com|whatsapp\.com|wa\.me|youtube\.com|discord\.com|t\.me|telegram\.org|snapchat\.com|pinterest\.com)$/;
const ROOM_PAGE = /^\/(?:games\/[^/]+\/rooms|room)\/[^/]+\/?$/;

/** The referrer's host, or "" when there is none or it is this site. */
function hostOf(referrer, origin) {
  try {
    const from = new URL(referrer);
    return from.origin === origin ? "" : from.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * How this page load arrived, worked out once (CC-174, CC-279): a marked share link, a room's link, a search
 * engine, a social site, another site, or directly. The referrer's host is read here and only its kind is kept.
 * Never the referrer, the address or the marker's sharer.
 *
 * @param {{ landing: { entry: string, via: string }, pathname: string, referrer: string, origin: string }} source
 *   `landing` is what `takeLanding` found before the router read the address
 * @returns {Readonly<{ entry: string, via: string }>} entry a TELEMETRY_ENTRIES value, via a share channel or ""
 */
export function entryOf({ landing, pathname, referrer, origin }) {
  if (landing.entry === SHARED_LINK_ENTRY) {
    return Object.freeze({ entry: TELEMETRY_ENTRIES.SHARED_LINK, via: landing.via });
  }
  if (ROOM_PAGE.test(pathname)) return Object.freeze({ entry: TELEMETRY_ENTRIES.ROOM_LINK, via: "" });
  const host = hostOf(referrer, origin);
  if (host === "") return Object.freeze({ entry: TELEMETRY_ENTRIES.DIRECT, via: "" });
  if (SEARCH.test(host)) return Object.freeze({ entry: TELEMETRY_ENTRIES.SEARCH, via: "" });
  if (SOCIAL.test(host)) return Object.freeze({ entry: TELEMETRY_ENTRIES.SOCIAL, via: "" });
  return Object.freeze({ entry: TELEMETRY_ENTRIES.OTHER_SITE, via: "" });
}
