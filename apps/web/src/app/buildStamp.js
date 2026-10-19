const COMMIT = /^[0-9a-f]{7,40}$/i;

/**
 * The name of a web build: the version and the short commit it was built from, or `local` for a build made without
 * one (a laptop or the Docker image). The same for every player of one deploy. `vite.config.js` works it out at build
 * time (CC-290).
 *
 * @param {{ version: string, commit: string | undefined }} source  `commit` is Render's RENDER_GIT_COMMIT
 * @returns {string}
 */
export function buildStamp({ version, commit }) {
  const short = commit !== undefined && COMMIT.test(commit) ? commit.slice(0, 7).toLowerCase() : "local";
  return `${version}+${short}`;
}

/**
 * This page's build, which feedback carries so the owner can tell a bug fixed since from a new one. A page served
 * loaded by a test was never stamped, and says `dev`.
 */
export const APP_BUILD = import.meta.env.VITE_APP_BUILD ?? "dev";
