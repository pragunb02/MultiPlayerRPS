import { describe, expect, it } from "vitest";

import {
  isCancelledRequest,
  isEngineOwnMessage,
  isFailedLoadMessage,
  isFetchRefusedWhileLeaving,
  isRealtimeDownMessage,
} from "./browserNoise.js";

// The exact wording each engine used in the browser suite (Playwright 1.64, CC-184).
describe("isCancelledRequest", () => {
  it("knows a cancelled request in Chromium's, Firefox's and WebKit's words", () => {
    for (const reason of [
      "net::ERR_ABORTED",
      "NS_BINDING_ABORTED",
      "cancelled",
      "Provisional navigation canceled.",
      "Blocked by Web Inspector",
      "NS_ERROR_ABORT",
    ]) {
      expect(isCancelledRequest(reason), reason).toBe(true);
    }
  });

  it("does not pass a request that really failed", () => {
    for (const reason of [
      "net::ERR_CONNECTION_REFUSED",
      "NS_ERROR_CONNECTION_REFUSED",
      "Could not connect to the server.",
      "cancelled because the server refused",
      "",
    ]) {
      expect(isCancelledRequest(reason), reason).toBe(false);
    }
  });
});

describe("isRealtimeDownMessage", () => {
  it("knows the realtime connection failing in Chromium's and Firefox's words", () => {
    for (const text of [
      "WebSocket connection to 'wss://localhost:4960/socket.io/?EIO=4&transport=websocket' failed: ",
      "Firefox can’t establish a connection to the server at wss://localhost:4960/socket.io/?EIO=4&transport=websocket.",
      "The connection to wss://localhost:4960/socket.io/?EIO=4&transport=websocket was interrupted while the page was loading.",
      '[JavaScript Error: "Firefox can’t establish a connection to the server at wss://localhost:4960/socket.io/?EIO=4&transport=websocket." {file: "https://localhost:4960/assets/index-BZ9zioxN.js" line: 10}]',
    ]) {
      expect(isRealtimeDownMessage(text), text).toBe(true);
    }
  });

  it("does not pass other connections failing, or other errors", () => {
    for (const text of [
      "WebSocket connection to 'wss://evil.example/chat' failed: ",
      "Firefox can’t establish a connection to the server at wss://localhost:4960/other.",
      "Uncaught TypeError: socket is undefined",
    ]) {
      expect(isRealtimeDownMessage(text), text).toBe(false);
    }
  });
});

describe("isEngineOwnMessage", () => {
  const selectStyle =
    "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";

  it("passes WebKit's message about styling its own drop-down", () => {
    expect(isEngineOwnMessage("webkit", selectStyle)).toBe(true);
  });

  it("still fails the same message from another engine, where it would be the app's fault", () => {
    expect(isEngineOwnMessage("chromium", selectStyle)).toBe(false);
    expect(isEngineOwnMessage("firefox", selectStyle)).toBe(false);
  });

  it("passes WebKit's hint about a board file fetched ahead of time, and only for the site's own scripts", () => {
    const hint = (url) =>
      `The resource ${url} was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it wasn't preloaded for nothing.`;

    expect(isEngineOwnMessage("webkit", hint("https://localhost:4960/assets/RpsBoard-CqMSpa6U.js"))).toBe(
      true,
    );
    expect(isEngineOwnMessage("chromium", hint("https://localhost:4960/assets/RpsBoard-CqMSpa6U.js"))).toBe(
      false,
    );
    expect(isEngineOwnMessage("webkit", hint("https://evil.example/x.js"))).toBe(false);
  });

  it("still fails any other security policy message on WebKit", () => {
    expect(
      isEngineOwnMessage(
        "webkit",
        "Refused to load https://evil.example/x.js because it does not appear in the script-src directive of the Content Security Policy.",
      ),
    ).toBe(false);
  });
});

describe("isFetchRefusedWhileLeaving", () => {
  const ORIGIN = "https://localhost:4960";
  const refused = (url) =>
    `Fetch API cannot load ${url} due to access control checks.\n    at n (https://localhost:4960/assets/index.js:10:214999)`;

  it("passes WebKit refusing the site's own request while the page reloads", () => {
    expect(isFetchRefusedWhileLeaving("webkit", refused(`${ORIGIN}/api/progress`), ORIGIN)).toBe(true);
  });

  it("still fails a refused request to another site, or one that is not even an address", () => {
    expect(isFetchRefusedWhileLeaving("webkit", refused("https://api.example/x"), ORIGIN)).toBe(false);
    expect(isFetchRefusedWhileLeaving("webkit", refused("http://localhost:4960/api/progress"), ORIGIN)).toBe(
      false,
    );
    expect(isFetchRefusedWhileLeaving("webkit", refused("nowhere"), ORIGIN)).toBe(false);
  });

  it("still fails the same words from another engine, and any other page error", () => {
    expect(isFetchRefusedWhileLeaving("chromium", refused(`${ORIGIN}/api/progress`), ORIGIN)).toBe(false);
    expect(isFetchRefusedWhileLeaving("webkit", "TypeError: undefined is not an object", ORIGIN)).toBe(false);
    expect(isFetchRefusedWhileLeaving("webkit", "", ORIGIN)).toBe(false);
  });
});

describe("isFailedLoadMessage", () => {
  it("knows each engine repeating a failed request in the console", () => {
    for (const text of [
      "Failed to load resource: the server responded with a status of 404 (Not Found)",
      '[JavaScript Warning: "Loading failed for the module with source “https://localhost:4960/assets/index-BRtbBd4p.js”." {file: "https://localhost:4960/" line: 11}]',
      "Loading failed for the <script> with source “https://localhost:4960/assets/x.js”.",
    ]) {
      expect(isFailedLoadMessage(text), text).toBe(true);
    }
  });

  it("does not pass other errors", () => {
    expect(isFailedLoadMessage("TypeError: Load failed")).toBe(false);
    expect(isFailedLoadMessage("Uncaught SyntaxError: Unexpected token")).toBe(false);
  });
});

describe("isEngineOwnMessage on Firefox", () => {
  const layout = (file) =>
    `[JavaScript Warning: "Layout was forced before the page was fully loaded. If stylesheets are not yet loaded this may cause a flash of unstyled content." {file: "${file}" line: 400}]`;

  it("passes the warning when the test itself measured the page", () => {
    expect(isEngineOwnMessage("firefox", layout("debugger eval code"))).toBe(true);
  });

  it("still fails the warning from the app's own files, and on other engines", () => {
    expect(isEngineOwnMessage("firefox", layout("https://localhost:4960/assets/index.js"))).toBe(false);
    expect(isEngineOwnMessage("webkit", layout("debugger eval code"))).toBe(false);
  });
});
