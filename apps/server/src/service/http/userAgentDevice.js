import { DEVICE_BROWSERS as BROWSERS, DEVICE_SYSTEMS as SYSTEMS } from "@classicade/shared";

// The first rule that matches wins, so the order matters. Edge, Opera and Samsung Internet also say "Chrome", and
// every browser on an iPhone also says "Safari". An iPhone also says "like Mac OS X", and Android also says "Linux".
const BROWSER_RULES = Object.freeze([
  [/\bEdg(?:e|A|iOS)?\//, BROWSERS.EDGE],
  [/\b(?:OPR|OPiOS)\//, BROWSERS.OPERA],
  [/\bSamsungBrowser\//, BROWSERS.SAMSUNG],
  [/\b(?:Firefox|FxiOS)\//, BROWSERS.FIREFOX],
  [/\b(?:Chrome|CriOS|Chromium)\//, BROWSERS.CHROME],
  [/\bVersion\/[\d.]+.*\bSafari\//, BROWSERS.SAFARI],
]);
const SYSTEM_RULES = Object.freeze([
  [/\bAndroid\b/, SYSTEMS.ANDROID],
  [/\b(?:iPhone|iPod)\b/, SYSTEMS.IPHONE],
  [/\biPad\b/, SYSTEMS.IPAD],
  [/\bWindows\b/, SYSTEMS.WINDOWS],
  [/\bCrOS\b/, SYSTEMS.CHROME_OS],
  [/\bMac OS X\b/, SYSTEMS.MAC],
  [/\bLinux\b/, SYSTEMS.LINUX],
]);

// Real user agents are a few hundred characters. A longer one is cut before it is read, so a huge header costs
// nothing.
const MAX_LENGTH = 512;

const firstMatch = (text, rules, unknown) => rules.find(([pattern]) => pattern.test(text))?.[1] ?? unknown;

/**
 * The coarse browser and system a user agent names, such as Chrome on Android, from closed lists (CC-262). Nothing
 * else is kept, not even a version, so the stored device says no more about the player than the list shows.
 *
 * @param {string} userAgent  the request's User-Agent header, empty when it has none
 * @returns {Readonly<{ browser: string, system: string }>} values of BROWSERS and SYSTEMS
 */
export function deviceFromUserAgent(userAgent) {
  const text = userAgent.slice(0, MAX_LENGTH);
  return Object.freeze({
    browser: firstMatch(text, BROWSER_RULES, BROWSERS.UNKNOWN),
    system: firstMatch(text, SYSTEM_RULES, SYSTEMS.UNKNOWN),
  });
}
