// What the players fixture (fixtures.js) may let pass, in the wording of each browser engine. Everything else a
// browser reports fails the test. Each rule is as narrow as the engine's wording allows, so a real problem still
// shows up in at least one engine (CC-184).

/**
 * The page moved on and the browser cancelled a request it no longer needed. That is not a failure. Chromium says
 * `net::ERR_ABORTED`, Firefox `NS_BINDING_ABORTED` and WebKit `cancelled`, or for a page load that another one
 * replaced, `Provisional navigation canceled.` A test that stops a request on purpose with `route.abort()` gets the
 * first two in Chromium and Firefox, and `Blocked by Web Inspector` in WebKit, which only Playwright causes.
 *
 * @param {string} errorText what the browser gave as the reason the request failed
 * @returns {boolean}
 */
export const isCancelledRequest = (errorText) =>
  /^(net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled|Provisional navigation canceled\.|Blocked by Web Inspector)$/i.test(
    errorText,
  );

/** The realtime connection failing to reach the server, one pattern per engine's wording. */
const REALTIME_DOWN = Object.freeze([
  // Chromium
  /^WebSocket connection to '[^']*\/socket\.io\/[^']*' failed/,
  // Firefox, which may wrap the message as [JavaScript Error: "the message" {file: "the script" line: 10}]
  /^(?:\[JavaScript Error: ")?Firefox can’t establish a connection to the server at wss?:\/\/[^ ]*\/socket\.io\//,
  /^(?:\[JavaScript Error: ")?The connection to wss?:\/\/[^ ]*\/socket\.io\/[^ ]* was interrupted while the page was loading\./,
]);

/**
 * While a test restarts the server, the browser's realtime connection fails until the next process is up, and
 * each engine logs every attempt in its own words. That is the expected cost of a restart, and the only one
 * (CC-101). Outside a restart the same message is a real failure.
 *
 * @param {string} text the console message
 * @returns {boolean}
 */
export const isRealtimeDownMessage = (text) => REALTIME_DOWN.some((pattern) => pattern.test(text));

/**
 * WebKit logs this for every `<select>` on a page whose security policy allows only the site's own stylesheets,
 * even on a page with nothing else on it. It is WebKit styling its own drop-down, not the app, and it was checked
 * on a blank page with the same policy. Chromium and Firefox do not log it, so a real refused stylesheet still
 * fails there.
 */
const WEBKIT_SELECT_STYLE =
  "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";

/**
 * WebKit's hint that a script file was fetched ahead of time and then not run within a few seconds of the page
 * loading. The app fetches a game board's files ahead of time as it starts loading the board, and on a busy test
 * machine running it can take longer than WebKit's few seconds. It is advice about speed, not a failure, and only
 * WebKit gives it for these files.
 */
const WEBKIT_PRELOAD_HINT =
  /^The resource https:\/\/[^ ]+\/assets\/[\w-]+\.js was preloaded using link preload but not used within a few seconds from the window's load event\./;

/**
 * A console message the browser engine writes about itself, not about the app.
 *
 * @param {string} engine the Playwright browser name: `chromium`, `firefox` or `webkit`
 * @param {string} text the console message
 * @returns {boolean}
 */
export const isEngineOwnMessage = (engine, text) =>
  engine === "webkit" && (text === WEBKIT_SELECT_STYLE || WEBKIT_PRELOAD_HINT.test(text));

/**
 * WebKit refuses a request the page starts while it is reloading or leaving, and reports it as a page error in the
 * words of a blocked cross-site request: "Fetch API cannot load https://the.site/api/x due to access control
 * checks." The app's own client already turns the refusal into a failed request. A request to the site itself can
 * never really be blocked that way, so only those pass. A real cross-site refusal still fails the test.
 *
 * @param {string} engine the Playwright browser name
 * @param {string} stack the page error's stack, whose first line is WebKit's full message
 * @param {string} origin the site under test, such as `https://localhost:4960`
 * @returns {boolean}
 */
export function isFetchRefusedWhileLeaving(engine, stack, origin) {
  const [first] = stack.split("\n");
  const refused = /^Fetch API cannot load (\S+) due to access control checks\.$/.exec(first);
  return engine === "webkit" && refused !== null && URL.parse(refused[1])?.origin === origin;
}
