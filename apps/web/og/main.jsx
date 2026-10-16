import { createRoot } from "react-dom/client";
import { gameForSlug } from "@classicade/shared";
import { OgCard } from "./OgCard.jsx";
import "../src/styles/global.css";

// Draws the card named in the address (?card=chess, or ?card=classicade for the site's own) and marks the body
// once it is on screen, so render.mjs knows when to take the screenshot.
const name = new URLSearchParams(window.location.search).get("card") ?? "classicade";
createRoot(document.getElementById("root")).render(<OgCard game={gameForSlug(name)} />);
requestAnimationFrame(() => requestAnimationFrame(() => document.body.setAttribute("data-ready", "")));
