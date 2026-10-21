/** The module that lists the app's lazy pages. Only the modules it imports with `import()` are pages. */
const ROUTE_TABLE = /\/src\/app\/routePages\.js$/;

/** A page's name from its module: `src/pages/PlayPage/PlayPage.jsx` is `PlayPage`, the export lazyRoute names. */
const NAME = /\/(\w+)\.jsx$/;

/**
 * Each lazy page's own files in a build, by the page's name (CC-322): its chunk and the chunks it imports that the
 * first route does not already load, and the stylesheets those bring. The app hints the browser to fetch them when a
 * link to the page is pointed at (`apps/web/src/app/routeFiles.js`). Paths start with `base`, as the browser asks.
 *
 * @param {Record<string, any>} bundle  Rollup's output bundle
 * @param {{ base: string, pages: ReadonlySet<string> }} build  the site's base path, such as `/`, and the module ids
 *   of the lazy pages
 * @returns {Record<string, { js: string[], css: string[] }>}
 */
export function routeFilesOf(bundle, { base, pages }) {
  const chunks = new Map(
    Object.values(bundle)
      .filter((item) => item.type === "chunk")
      .map((chunk) => [chunk.fileName, chunk]),
  );
  const closure = (file, into = new Set()) => {
    if (!into.has(file)) {
      into.add(file);
      for (const imported of chunks.get(file).imports) closure(imported, into);
    }
    return into;
  };
  const firstRoute = new Set();
  for (const chunk of chunks.values()) if (chunk.isEntry) closure(chunk.fileName, firstRoute);

  const files = {};
  for (const chunk of chunks.values()) {
    const name = pages.has(chunk.facadeModuleId) ? NAME.exec(chunk.facadeModuleId)?.[1] : undefined;
    if (name !== undefined) {
      const own = [...closure(chunk.fileName)].filter((file) => !firstRoute.has(file));
      const css = new Set(own.flatMap((file) => [...(chunks.get(file).viteMetadata?.importedCss ?? [])]));
      files[name] = {
        js: own.map((file) => `${base}${file}`),
        css: [...css].map((file) => `${base}${file}`),
      };
    }
  }
  return files;
}

/**
 * A Vite plugin that writes `routeFilesOf` into the built index.html as a JSON data block (`id="route-files"`).
 * A data block is never run, so the security policy, which allows only the site's own script files, is unchanged.
 * `<` is escaped so the text can never end the block early.
 *
 * @returns {import("vite").Plugin}
 */
export function routeFiles() {
  let base = "/";
  /** @type {Set<string>} */
  const pages = new Set();
  return {
    name: "classicade-route-files",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    moduleParsed(info) {
      if (ROUTE_TABLE.test(info.id)) {
        for (const id of info.dynamicallyImportedIds) pages.add(id);
      }
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        return [
          {
            tag: "script",
            attrs: { type: "application/json", id: "route-files" },
            children: JSON.stringify(routeFilesOf(context.bundle, { base, pages })).replaceAll(
              "<",
              "\\u003c",
            ),
            injectTo: "body",
          },
        ];
      },
    },
  };
}
