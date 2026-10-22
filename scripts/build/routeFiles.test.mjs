import { describe, expect, it } from "vitest";
import { routeFiles, routeFilesOf } from "./routeFiles.mjs";

const PAGES = "/repo/apps/web/src/pages";
const chunk = (fileName, extra = {}) => ({
  type: "chunk",
  fileName,
  isEntry: false,
  facadeModuleId: null,
  imports: [],
  viteMetadata: { importedCss: new Set() },
  ...extra,
});

const BUNDLE = {
  "assets/index-a.js": chunk("assets/index-a.js", { isEntry: true, imports: ["assets/react-b.js"] }),
  "assets/react-b.js": chunk("assets/react-b.js"),
  "assets/PlayPage-c.js": chunk("assets/PlayPage-c.js", {
    facadeModuleId: `${PAGES}/PlayPage/PlayPage.jsx`,
    imports: ["assets/react-b.js", "assets/art-d.js"],
    viteMetadata: { importedCss: new Set(["assets/PlayPage-c.css"]) },
  }),
  "assets/art-d.js": chunk("assets/art-d.js", {
    imports: ["assets/react-b.js"],
    viteMetadata: { importedCss: new Set(["assets/art-d.css"]) },
  }),
  "assets/RpsBoard-e.js": chunk("assets/RpsBoard-e.js", {
    facadeModuleId: "/repo/apps/web/src/games/RpsBoard.jsx",
  }),
  "assets/index-a.css": { type: "asset", fileName: "assets/index-a.css" },
};
const PAGE_IDS = new Set([`${PAGES}/PlayPage/PlayPage.jsx`]);

describe("routeFilesOf: each lazy page's own files (CC-322)", () => {
  it("lists a page's chunk and its imports the first route lacks, with their CSS, and nothing that is not a page", () => {
    expect(routeFilesOf(BUNDLE, { base: "/", pages: PAGE_IDS })).toEqual({
      PlayPage: {
        js: ["/assets/PlayPage-c.js", "/assets/art-d.js"],
        css: ["/assets/PlayPage-c.css", "/assets/art-d.css"],
      },
    });
  });
});

describe("routeFiles: the Vite plugin", () => {
  it("learns the pages from the route table's imports and writes the files into index.html as data", () => {
    const plugin = routeFiles();
    plugin.configResolved({ base: "/" });
    plugin.moduleParsed({ id: "/repo/apps/web/src/main.jsx", dynamicallyImportedIds: ["/x.jsx"] });
    plugin.moduleParsed({
      id: "/repo/apps/web/src/app/routePages.js",
      dynamicallyImportedIds: [...PAGE_IDS],
    });
    const bundle = {
      ...BUNDLE,
      "assets/PlayPage-c.js": { ...BUNDLE["assets/PlayPage-c.js"], viteMetadata: undefined },
      "assets/art-d.js": {
        ...BUNDLE["assets/art-d.js"],
        viteMetadata: { importedCss: new Set(["a</script>.css"]) },
      },
    };

    const [tag] = plugin.transformIndexHtml.handler("", { bundle });

    expect(plugin.apply).toBe("build");
    expect(tag).toMatchObject({ tag: "script", attrs: { type: "application/json", id: "route-files" } });
    expect(tag.children).not.toContain("</script>");
    expect(JSON.parse(tag.children)).toEqual({
      PlayPage: { js: ["/assets/PlayPage-c.js", "/assets/art-d.js"], css: ["/a</script>.css"] },
    });
  });
});
