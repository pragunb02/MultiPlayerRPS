import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App.jsx";
import { removeServerHead } from "./app/serverHead.js";
import { createApiClient } from "./lib/api.js";
import { createSocketClient } from "./lib/socket.js";
import { createSoundPlayer } from "./lib/sound/soundPlayer.js";
import { createSoundPreferences } from "./lib/sound/soundPreferences.js";
import "./styles/global.css";

// Composition root of the web app: the only place real clients are created.
const sound = createSoundPlayer({
  // Older Safari only has the prefixed name. Without either, creating the context throws and the app stays silent.
  createContext: () => new (window.AudioContext ?? window.webkitAudioContext)(),
  // Browsers without this API cannot tell, so audio is tried and a refusal just means silence.
  hasUserActivation: () => navigator.userActivation?.isActive ?? true,
  preferences: createSoundPreferences({ getStorage: () => window.localStorage }),
});
sound.listen(window);
const services = { api: createApiClient(), socket: createSocketClient(), sound };
removeServerHead(document);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App services={services} />
    </BrowserRouter>
  </StrictMode>,
);
