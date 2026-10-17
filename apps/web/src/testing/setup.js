import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { installMatchMedia } from "./matchMedia.js";
import { restoreVisibility } from "./visibility.js";

// jsdom has no matchMedia; every browser does. Tests start with full motion and can switch it (useReducedMotion).
beforeEach(() => {
  installMatchMedia();
});

afterEach(() => {
  cleanup();
  restoreVisibility();
  document.title = "";
});
