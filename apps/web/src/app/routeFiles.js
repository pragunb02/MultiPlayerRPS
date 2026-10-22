/** The id of the data block the build writes into index.html (`scripts/build/routeFiles.mjs`, CC-322). */
export const ROUTE_FILES_ID = "route-files";

/**
 * Each page's own files in this build, by the page's name: its scripts, and the stylesheets they bring. The build
 * writes them into index.html as data, which is never run. A page without the block, such as a test page, has none.
 *
 * @param {Pick<Document, "getElementById">} document
 * @returns {Record<string, { js: string[], css: string[] }>}
 */
export function routeFilesIn(document) {
  const block = document.getElementById(ROUTE_FILES_ID);
  return block === null ? {} : JSON.parse(block.textContent);
}

/**
 * Asks the browser to fetch a page's files ahead of time, as a hint only (CC-322). Scripts get
 * `<link rel="modulepreload">` and stylesheets `<link rel="prefetch">`, so nothing runs and nothing waits on them.
 * A file that fails to arrive, because the tab is older than the last deploy or the network dropped, only fails its
 * own link, which is removed so a later hint can try again. Nothing else happens: no reload, no error page. The
 * page's real download, when the player opens it, is what reloads a stale tab (`staleBuild.js`).
 *
 * @param {{ document: Document, name: string }} options  `name` is the page's export, such as `PlayPage`
 */
export function prefetchPage({ document, name }) {
  const files = routeFilesIn(document)[name];
  if (files === undefined) {
    return;
  }
  for (const href of files.js) addHint(document, "modulepreload", href);
  for (const href of files.css) addHint(document, "prefetch", href);
}

/**
 * A built file of this site: a script or stylesheet in `/assets/`, named by the build. The list is read from the
 * page's own text, so anything else, such as another site's address or a `javascript:` URL, is never linked.
 */
const BUILT_FILE = /^\/assets\/[\w.-]+\.(?:js|css)$/;

/** One hint link, unless a link to the same file is already on the page (ours, or one the build or Vite added). */
function addHint(document, rel, href) {
  if (typeof href !== "string" || !BUILT_FILE.test(href)) {
    return;
  }
  const known = [...document.querySelectorAll("link[href]")].some(
    (link) => link.getAttribute("href") === href,
  );
  if (known) {
    return;
  }
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  // The same request mode as Vite's own links and module scripts, so the browser can reuse what it fetched.
  link.crossOrigin = "";
  link.addEventListener("error", () => link.remove(), { once: true });
  document.head.append(link);
}
