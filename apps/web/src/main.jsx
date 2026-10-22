import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App.jsx";
import { followInputModality } from "./app/inputModality.js";
import { takeLanding } from "./app/landing.js";
import { needsSocketNow, preloadRouteFor } from "./app/routePages.js";
import { removeServerHead } from "./app/serverHead.js";
import { recoverFromStaleBuild } from "./app/staleBuild.js";
import { noteWaitingScreen } from "./app/wakingUp.js";
import { createApiClient } from "./lib/api.js";
import { createDownload } from "./lib/download.js";
import { whenIdle } from "./lib/idle.js";
import { createSessionBroadcast } from "./lib/sessionBroadcast.js";
import { createSocketClient } from "./lib/socket.js";
import { createSoundPlayer } from "./lib/sound/soundPlayer.js";
import { createSoundPreferences } from "./lib/sound/soundPreferences.js";
import { entryOf } from "./lib/telemetry/entry.js";
import { codeOf, socketCodeOf } from "./lib/telemetry/errorFields.js";
import { createTelemetryFacade } from "./lib/telemetry/facade.js";
import { createInterruptionTracker } from "./lib/telemetry/interruptions.js";
import { isSwitchedOff, isTelemetryOff } from "./lib/telemetry/optOut.js";
import { roundMs, TELEMETRY_MAX_SINCE_LOAD_MS } from "@classicade/shared";
import "./styles/global.css";

// Composition root of the web app: the only place real clients are created.
// Usage counts first (CC-174): they hold events in memory until the flag says whether to send them, and send
// nothing when the switch, GPC or DNT says no.
const isOff = () =>
  isTelemetryOff({ getStorage: () => window.localStorage, navigator, location: window.location });
// Its own files download through the stale build's `quietly`, so a missing one never reloads the tab (CC-333).
const telemetry = createTelemetryFacade({ isOff, quietly: (run) => recovery.quietly(run) });
// The kind of player comes once the session has answered (TelemetryStub.jsx).
telemetry.setContext({ path: window.location.pathname });
// Before the router, because it may change the address before the router reads it (CC-181).
const recovery = recoverFromStaleBuild({
  window,
  now: () => Date.now(),
  onFailedLoad: (kind) => telemetry.track("client_errored", { kind, error_type: "other" }),
});
// Also before the router, which must never see the share channel marker or keep it in the history (CC-279).
telemetry.setLanding(
  entryOf({
    landing: takeLanding({ window, document }),
    pathname: window.location.pathname,
    referrer: document.referrer,
    origin: window.location.origin,
  }),
);
// Interruptions and steps (CC-313), counted through the same facade and only while its own flag is on.
const interruptions = createInterruptionTracker({
  telemetry,
  now: () => window.performance.now(),
  strict: !import.meta.env.PROD,
});
const sound = createSoundPlayer({
  // Older Safari only has the prefixed name. Without either, creating the context throws and the app stays silent.
  createContext: () => new (window.AudioContext ?? window.webkitAudioContext)(),
  // Browsers without this API cannot tell, so audio is tried and a refusal just means silence.
  hasUserActivation: () => navigator.userActivation?.isActive ?? true,
  preferences: createSoundPreferences({ getStorage: () => window.localStorage }),
});
sound.listen(window);
const services = {
  telemetry,
  interruptions,
  api: createApiClient({
    // The server hears the switch too, so it records no sign-up, login or error about this browser (CC-174).
    countsOff: () => isSwitchedOff(() => window.localStorage),
    onRequest: () => telemetry.noteRequest("http"),
    // The API's templates load with the client (CC-322), which names the endpoint.
    onFailure: ({ path, status, error }) =>
      telemetry.track("request_failed", ({ endpointOf }) => ({
        endpoint: endpointOf(`/api${path}`),
        status,
        code: codeOf(error),
      })),
  }),
  // A download of Socket.IO tried again after it failed never reloads the tab for a newer version (CC-333).
  socket: createSocketClient({
    quietly: recovery.quietly,
    onRequest: () => telemetry.noteRequest("socket"),
    onChange: ({ state, reason, afterS }) =>
      telemetry.track("socket_changed", {
        state,
        code: socketCodeOf(reason),
        ...(afterS !== undefined && { after_s: afterS }),
      }),
    onFirstMove: (gameId) => {
      telemetry.track("gameplay_started", {
        game_id: gameId,
        entry: telemetry.landing.entry,
        since_load_ms: roundMs(window.performance.now(), TELEMETRY_MAX_SINCE_LOAD_MS),
        ...(interruptions.isEnabled() && { interruptions_before: interruptions.interruptionsBefore() }),
      });
      interruptions.reach("visit_to_play", "first_move");
    },
  }),
  sound,
  // Tabs of this browser tell each other the session changed (ADR-033). Older browsers without it get none.
  sessionBroadcast: createSessionBroadcast({ Channel: window.BroadcastChannel }),
  // Saves the player's data export as a file (CC-035).
  download: createDownload({ document, URL: window.URL }),
};
removeServerHead(document);
// Focus moved in code shows its ring only for keyboard players (CC-100).
followInputModality(document);

// A page that downloads on demand, opened by its address, is fetched before the first render, as the router's own
// lazy routes do. The first render then shows the page itself and not its skeleton, so nothing moves (CC-322).
// Until then the waking up screen of index.html stays. Home is in the first download and renders at once.
preloadRouteFor(window.location.pathname).then(() => {
  // Before the first render, which takes the waking up screen of index.html away (CC-232).
  noteWaitingScreen({ document, window });
  // Socket.IO is not in the first download (CC-333). A page that needs the connection to show anything asks for it
  // now: after its own code, so the two do not share the line, and while the session is asked.
  if (needsSocketNow(window.location.pathname)) {
    services.socket.needNow();
  }
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <BrowserRouter>
        <App services={services} />
      </BrowserRouter>
    </StrictMode>,
  );
  // After the first render, when the browser has nothing more urgent to do. Connecting waits for the session anyway.
  whenIdle({ window, run: () => services.socket.needNow() });
});
