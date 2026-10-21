import { describe, expect, it } from "vitest";
import { DEVICE_BROWSERS as BROWSERS, DEVICE_SYSTEMS as SYSTEMS } from "@classicade/shared";
import { deviceFromUserAgent } from "./userAgentDevice.js";

// Real user agents, as each browser sent them in 2026 (Chrome's are the reduced ones).
const AGENTS = Object.freeze({
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
  firefoxIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/123.0.0.0",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
});

describe("deviceFromUserAgent (CC-262)", () => {
  it.each([
    [AGENTS.chromeAndroid, "Chrome", "Android"],
    [AGENTS.chromeWindows, "Chrome", "Windows"],
    [AGENTS.chromeIphone, "Chrome", "iPhone"],
    [AGENTS.safariIphone, "Safari", "iPhone"],
    [AGENTS.safariIpad, "Safari", "iPad"],
    [AGENTS.safariMac, "Safari", "macOS"],
    [AGENTS.firefoxLinux, "Firefox", "Linux"],
    [AGENTS.firefoxIphone, "Firefox", "iPhone"],
    [AGENTS.edgeWindows, "Edge", "Windows"],
    [AGENTS.operaWindows, "Opera", "Windows"],
    [AGENTS.samsungAndroid, "Samsung Internet", "Android"],
    [AGENTS.chromeOs, "Chrome", "ChromeOS"],
  ])("reads a coarse browser and system from %s", (userAgent, browser, system) => {
    expect(deviceFromUserAgent(userAgent)).toEqual({ browser, system });
  });

  it.each(["", "curl/8.7.1", "x".repeat(5000)])(
    "says unknown for anything it does not know (%#)",
    (userAgent) => {
      expect(deviceFromUserAgent(userAgent)).toEqual({ browser: BROWSERS.UNKNOWN, system: SYSTEMS.UNKNOWN });
    },
  );

  it("returns a frozen answer from the closed lists only", () => {
    const device = deviceFromUserAgent(AGENTS.chromeAndroid);

    expect(Object.isFrozen(device)).toBe(true);
    expect(Object.values(BROWSERS)).toContain(device.browser);
    expect(Object.values(SYSTEMS)).toContain(device.system);
  });

  it("never keeps a version or anything else from the user agent", () => {
    const device = deviceFromUserAgent(AGENTS.chromeAndroid);

    expect(JSON.stringify(device)).not.toMatch(/\d/);
  });
});
