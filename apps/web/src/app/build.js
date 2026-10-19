/**
 * This page's build, which feedback carries so the owner can tell a bug fixed since from a new one (CC-290).
 * `vite.config.js` stamps it with `buildStamp`. A page loaded by a test was never stamped, and says `dev`.
 */
export const APP_BUILD = import.meta.env.VITE_APP_BUILD ?? "dev";
