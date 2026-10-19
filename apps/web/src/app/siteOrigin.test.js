import { afterEach, describe, expect, it } from "vitest";
import { siteOrigin, siteOriginOf } from "./siteOrigin.js";

const PAGE = { origin: "https://classicade-xyz.onrender.com" };

/** A document whose head has the server's site address tag with this content, or no tag at all. */
function documentWith(content) {
  const doc = document.implementation.createHTMLDocument("t");
  if (content !== undefined) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "classicade:site-origin");
    meta.setAttribute("content", content);
    doc.head.append(meta);
  }
  return doc;
}

describe("siteOriginOf", () => {
  it("is the address the server wrote into the page, not the one the page was opened at", () => {
    expect(siteOriginOf({ document: documentWith("https://classicade.example"), location: PAGE })).toBe(
      "https://classicade.example",
    );
  });

  it("keeps only the origin of what the server wrote", () => {
    expect(siteOriginOf({ document: documentWith("https://classicade.example/x?y"), location: PAGE })).toBe(
      "https://classicade.example",
    );
  });

  it("is the page's own address where no server wrote the tag, as on the Vite dev server", () => {
    expect(siteOriginOf({ document: documentWith(undefined), location: PAGE })).toBe(PAGE.origin);
  });

  it.each(["", "not a url", "javascript:alert(1)", "data:text/html,x", "ftp://classicade.example"])(
    "never uses a tag that is not a web address: %j",
    (content) => {
      expect(siteOriginOf({ document: documentWith(content), location: PAGE })).toBe(PAGE.origin);
    },
  );
});

describe("siteOrigin", () => {
  afterEach(() => document.head.querySelector('meta[name="classicade:site-origin"]')?.remove());

  it("reads this page's document and address", () => {
    expect(siteOrigin()).toBe(window.location.origin);

    const meta = document.createElement("meta");
    meta.setAttribute("name", "classicade:site-origin");
    meta.setAttribute("content", "https://classicade.example");
    document.head.append(meta);

    expect(siteOrigin()).toBe("https://classicade.example");
  });
});
