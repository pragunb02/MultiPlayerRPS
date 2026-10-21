import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyRoute } from "./lazyRoute.jsx";
import { prefetchPage, ROUTE_FILES_ID, routeFilesIn } from "./routeFiles.js";
import { recoverFromStaleBuild } from "./staleBuild.js";

const FILES = {
  PlayPage: {
    js: ["/assets/PlayPage-a.js", "/assets/shared-b.js"],
    css: ["/assets/PlayPage-c.css"],
  },
};

/** The data block the build writes into index.html. */
function writeBlock(files = FILES) {
  const block = document.createElement("script");
  block.type = "application/json";
  block.id = ROUTE_FILES_ID;
  block.textContent = JSON.stringify(files);
  document.body.append(block);
}

const hints = () =>
  [...document.head.querySelectorAll("link")].map((link) => [
    link.rel,
    link.getAttribute("href"),
    link.crossOrigin,
  ]);

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("routeFilesIn", () => {
  it("reads each page's files from index.html, and none from a page without them", () => {
    expect(routeFilesIn(document)).toEqual({});
    writeBlock();
    expect(routeFilesIn(document)).toEqual(FILES);
  });
});

describe("prefetchPage: a page's files fetched as a hint only (CC-322)", () => {
  it("adds a modulepreload for each script and a prefetch for each stylesheet, once", () => {
    writeBlock();
    const existing = document.createElement("link");
    existing.rel = "modulepreload";
    existing.href = "/assets/shared-b.js";
    document.head.append(existing);

    prefetchPage({ document, name: "PlayPage" });
    prefetchPage({ document, name: "PlayPage" });

    expect(hints()).toEqual([
      ["modulepreload", "/assets/shared-b.js", null],
      ["modulepreload", "/assets/PlayPage-a.js", ""],
      ["prefetch", "/assets/PlayPage-c.css", ""],
    ]);
  });

  it("does nothing for a page the build lists no files for", () => {
    writeBlock();

    prefetchPage({ document, name: "Unknown" });

    expect(hints()).toEqual([]);
  });

  // The same in a tab older than the last deploy, where the file is gone (404), and on a dropped connection: the
  // browser fires `error` on the link either way.
  it.each(["the file is gone after a deploy", "the connection dropped"])(
    "does nothing when a file fails to arrive because %s: no reload, no download, and a later hint tries again",
    async () => {
      writeBlock();
      const reload = vi.fn();
      const fakeWindow = {
        location: { href: "https://classicade.test/", reload },
        history: { state: null, replaceState: vi.fn() },
        addEventListener: (type, listener) => window.addEventListener(type, listener),
        removeEventListener: (type, listener) => window.removeEventListener(type, listener),
      };
      const stop = recoverFromStaleBuild({ window: fakeWindow, now: () => 0 });
      const preloadErrors = vi.fn();
      window.addEventListener("vite:preloadError", preloadErrors);
      const load = vi.fn(async () => ({ PlayPage: () => null }));
      const Page = lazyRoute(load, "PlayPage");

      Page.prefetch();
      for (const link of document.head.querySelectorAll("link")) link.dispatchEvent(new Event("error"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(hints()).toEqual([]);
      expect(load).not.toHaveBeenCalled();
      expect(preloadErrors).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      Page.prefetch();
      expect(hints()).toHaveLength(3);
      window.removeEventListener("vite:preloadError", preloadErrors);
      stop();
    },
  );
});
