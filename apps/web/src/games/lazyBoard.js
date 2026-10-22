import { lazy } from "react";

/** Never settles: the page is about to reload, so the board just keeps waiting. */
export const RELOADING = new Promise(() => {});

/**
 * A board component that is downloaded the first time it is shown, so a player only downloads the games they open.
 *
 * When the download fails because the tab is older than the last deploy, the page reloads to the new version
 * (app/staleBuild.js). Vite then hands back nothing instead of the module, and the board keeps showing its loading
 * state until the reload, instead of the error page. Any other failure still reaches the error page.
 *
 * @param {() => Promise<Record<string, import("react").ComponentType<any>> | undefined>} load  the dynamic import
 * @param {string} name   the export that is the board
 * @returns {import("react").LazyExoticComponent<import("react").ComponentType<any>>}
 */
export function lazyBoard(load, name) {
  return lazy(() => load().then((module) => (module === undefined ? RELOADING : { default: module[name] })));
}

/**
 * A game's pure engine, downloaded the first time two people start it on one phone (CC-223). It fails the same way
 * a board does: while the page reloads for a newer version it keeps waiting, and any other failure is passed on, so
 * the page can say the game did not load and offer to try again.
 *
 * @param {() => Promise<Record<string, unknown> | undefined>} load  the dynamic import
 * @param {string} name  the export that is the engine
 * @returns {() => Promise<any>}
 */
export const lazyEngine = (load, name) => () =>
  load().then((module) => (module === undefined ? RELOADING : module[name]));
