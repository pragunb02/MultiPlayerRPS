// The words a signed-in device is named by (CC-262, ADR-081). The server reads them from the user agent at sign-in,
// and the web app writes them as "Chrome on Android". Both read this one list.

/** Said when the browser or the system could not be told. */
export const DEVICE_UNKNOWN = "Unknown";

/** The browsers a device can be named by. Anything else is unknown. */
export const DEVICE_BROWSERS = Object.freeze({
  CHROME: "Chrome",
  EDGE: "Edge",
  FIREFOX: "Firefox",
  OPERA: "Opera",
  SAFARI: "Safari",
  SAMSUNG: "Samsung Internet",
  UNKNOWN: DEVICE_UNKNOWN,
});

/** The systems a device can be named by. Anything else is unknown. */
export const DEVICE_SYSTEMS = Object.freeze({
  ANDROID: "Android",
  CHROME_OS: "ChromeOS",
  IPAD: "iPad",
  IPHONE: "iPhone",
  LINUX: "Linux",
  MAC: "macOS",
  WINDOWS: "Windows",
  UNKNOWN: DEVICE_UNKNOWN,
});
