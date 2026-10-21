import { lazy, Suspense, useState } from "react";
import { RouteSkeleton } from "../components/RouteSkeleton/RouteSkeleton.jsx";
import { RELOADING } from "../games/lazyBoard.js";
import { prefetchPage } from "./routeFiles.js";

/**
 * A page whose code downloads the first time it is needed, so the first page a player opens carries only its own
 * code (CC-322). While it downloads, the page's place shows a skeleton of the same size.
 *
 * `preload()` downloads and runs the page's code before the first render when the player opens the page's address
 * directly (`main.jsx`). Once it is here the page renders at once, with no skeleton in between. A failed early
 * download is forgotten, so the next attempt tries again, and the one the page itself makes reaches the error page
 * as before.
 *
 * `prefetch()` is only a hint, for when a link to the page is pointed at, focused or touched (`routePrefetch.js`):
 * the browser fetches the page's files and runs nothing. If they fail, nothing happens (`routeFiles.js`).
 * When the download fails because the tab is older than the last deploy, the page reloads to the new version
 * (`staleBuild.js`) and the skeleton stays until then, as for a board.
 *
 * @param {() => Promise<Record<string, import("react").ComponentType<any>> | undefined>} load  the dynamic import
 * @param {string} name  the export that is the page
 * @returns {import("react").ComponentType<any> & { preload: () => Promise<unknown>, prefetch: () => void }}
 */
export function lazyRoute(load, name) {
  /** @type {import("react").ComponentType<any> | undefined} */
  let loaded;
  /** @type {Promise<{ default: import("react").ComponentType<any> }> | undefined} */
  let pending;
  const preload = () => {
    pending ??= load().then(
      (module) => {
        if (module === undefined) {
          return RELOADING;
        }
        loaded = module[name];
        return { default: loaded };
      },
      (error) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  const Lazy = lazy(preload);

  function LazyRoute(props) {
    // Chosen once per visit: switching from the lazy wrapper to the page later would remount it and lose its state.
    const [Page] = useState(() => loaded ?? Lazy);
    return (
      <Suspense fallback={<RouteSkeleton />}>
        <Page {...props} />
      </Suspense>
    );
  }
  LazyRoute.displayName = `LazyRoute(${name})`;
  LazyRoute.preload = preload;
  LazyRoute.prefetch = () => prefetchPage({ document, name });
  return LazyRoute;
}
