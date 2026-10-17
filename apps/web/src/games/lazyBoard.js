import { lazy } from "react";

/** Never settles: the page is about to reload, so the board just keeps waiting. */
const RELOADING = new Promise(() => {});

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
