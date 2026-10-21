import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App.jsx";
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
import "./styles/global.css";

// Composition root of the web app: the only place real clients are created.
// First of all, because it may change the address before the router reads it (CC-181).
recoverFromStaleBuild({ window, now: () => Date.now() });
// Also before the router, which must never see the share channel marker or keep it in the history (CC-279).
takeLanding({ window, document });
const sound = createSoundPlayer({
  // Older Safari only has the prefixed name. Without either, creating the context throws and the app stays silent.
  createContext: () => new (window.AudioContext ?? window.webkitAudioContext)(),
  // Browsers without this API cannot tell, so audio is tried and a refusal just means silence.
  hasUserActivation: () => navigator.userActivation?.isActive ?? true,
  preferences: createSoundPreferences({ getStorage: () => window.localStorage }),
});
sound.listen(window);
const services = {
  api: createApiClient(),
  socket: createSocketClient(),
  sound,
  // Tabs of this browser tell each other the session changed (ADR-033). Older browsers without it get none.
  sessionBroadcast: createSessionBroadcast({ Channel: window.BroadcastChannel }),
  // Saves the player's data export as a file (CC-035).
  download: createDownload({ document, URL: window.URL }),
};
removeServerHead(document);

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
