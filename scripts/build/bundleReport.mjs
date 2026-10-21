import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The numbers of one source map segment, decoded from base64 VLQ, as the source map format writes them.
 *
 * @param {string} segment
 * @returns {number[]}
 */
export function decodeSegment(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

/**
 * Splits a built chunk's code into the part each source file made, with the chunk's source map, the way
 * source-map-explorer does. The code is the minified code the browser downloads, so the sizes are real ones. Code
 * the map gives no source for, such as Rollup's own helpers, is left out.
 *
 * @param {string} code  the chunk's code
 * @param {{ sources: string[], mappings: string }} map  its source map
 * @returns {Map<number, string>} the code of each source, by its index in `map.sources`
 */
export function codeBySource(code, map) {
  const lines = code.split("\n");
  const parts = new Map();
  let source = 0;
  map.mappings.split(";").forEach((mappings, lineIndex) => {
    const line = lines[lineIndex] ?? "";
    let column = 0;
    const starts = [];
    for (const segment of mappings.split(",").filter(Boolean)) {
      const [columnStep, sourceStep] = decodeSegment(segment);
      column += columnStep;
      if (sourceStep === undefined) {
        starts.push({ column, source: -1 });
      } else {
        source += sourceStep;
        starts.push({ column, source });
      }
    }
    starts.forEach((start, index) => {
      if (start.source !== -1) {
        const end = starts[index + 1]?.column ?? line.length;
        parts.set(start.source, (parts.get(start.source) ?? "") + line.slice(start.column, end));
      }
    });
  });
  return parts;
}

/**
 * A module's name in the report: its path from the web app's folder with forward slashes, or `node_modules/` and
 * the path inside it for a dependency, wherever npm put it. Rollup marks its own helper modules with a leading
 * zero byte, which is dropped.
 *
 * @param {string} id  an absolute path, or a module id Rollup gives
 * @param {string} root  the web app's folder
 * @returns {string}
 */
export function moduleName(id, root) {
  const plain = id.replace(/^\0/, "").replace(/\?.*$/, "");
  const inPackages = plain.lastIndexOf("node_modules/");
  if (inPackages !== -1) {
    return plain.slice(inPackages);
  }
  return plain.startsWith("/") ? relative(root, plain).split(sep).join("/") : plain;
}

/** Each source file's share of one chunk, largest first, with the gzip size of its own code. */
function modulesOf(chunk, { root, outDir }) {
  const sizes = new Map();
  const add = (name, code) => sizes.set(name, (sizes.get(name) ?? "") + code);
  if (chunk.map) {
    const folder = resolve(outDir, dirname(chunk.fileName));
    for (const [index, code] of codeBySource(chunk.code, chunk.map)) {
      add(moduleName(resolve(folder, chunk.map.sources[index]), root), code);
    }
  } else {
    for (const [id, module] of Object.entries(chunk.modules)) {
      add(moduleName(id, root), module.code ?? "");
    }
  }
  return [...sizes]
    .filter(([, code]) => code.length > 0)
    .map(([name, code]) => ({ name, bytes: Buffer.byteLength(code), gzip: gzipSync(code).length }))
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * What the build made, chunk by chunk, for the bundle size check (CC-135, CC-322): each JavaScript chunk with the
 * chunks it imports, the CSS it brings, and each source file in it with the size of the code it made. Vite's
 * manifest has no module sizes, and the effect registry's budget is about one module.
 *
 * @param {Record<string, any>} bundle  Rollup's output bundle, as `generateBundle` gets it
 * @param {{ root: string, outDir: string }} where  the web app's folder and the build's absolute output folder
 */
export function bundleReportOf(bundle, where) {
  const chunks = Object.values(bundle)
    .filter((item) => item.type === "chunk")
    .map((chunk) => ({
      file: chunk.fileName,
      isEntry: chunk.isEntry,
      isDynamicEntry: chunk.isDynamicEntry,
      facade: chunk.facadeModuleId ? moduleName(chunk.facadeModuleId, where.root) : null,
      imports: chunk.imports,
      dynamicImports: chunk.dynamicImports,
      css: [...(chunk.viteMetadata?.importedCss ?? [])],
      modules: modulesOf(chunk, where),
    }));
  return { chunks };
}

/**
 * A Vite plugin that writes `bundleReportOf` to `file` after each production build. The file is outside the built
 * site on purpose, so the server never serves it.
 *
 * @param {{ file: string }} options  where to write the report
 * @returns {import("vite").Plugin}
 */
export function bundleReport({ file }) {
  const where = { root: "", outDir: "" };
  return {
    name: "classicade-bundle-report",
    apply: "build",
    configResolved(config) {
      where.root = config.root;
      where.outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(bundleReportOf(bundle, where), null, 1)}\n`);
    },
  };
}
