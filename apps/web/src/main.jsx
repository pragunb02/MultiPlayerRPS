import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App.jsx";
import { createApiClient } from "./lib/api.js";
import { createSocketClient } from "./lib/socket.js";
import "./styles/global.css";

// Composition root of the web app: the only place real clients are created.
const services = { api: createApiClient(), socket: createSocketClient() };

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App services={services} />
    </BrowserRouter>
  </StrictMode>,
);
