import { describe, expect, it } from "vitest";
import { createPageTemplate, escapeHtml, renderPageHead } from "./pageHead.js";

const ORIGIN = "https://classicade.example";

/** A page as the shared page list describes one, with text a test can choose. */
const pageWith = (fields = {}) => ({
  found: true,
  title: "Title",
  description: "Description",
  path: "/games/chess",
  indexable: true,
  image: "/og/chess.png",
  imageAlt: "Chess on ClassiCade",
  ...fields,
});

describe("escapeHtml", () => {
  it("escapes every character that could end text or an attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("leaves plain text as it is", () => {
    expect(escapeHtml("Join my Chess game · ClassiCade")).toBe("Join my Chess game · ClassiCade");
  });
});

describe("renderPageHead", () => {
  it("escapes the title, description and image text wherever they appear", () => {
    const head = renderPageHead({
      page: pageWith({ title: '"><script>x</script>', description: "a & b", imageAlt: "<img>" }),
      origin: ORIGIN,
    });

    expect(head).not.toContain("<script>");
    expect(head).toContain("<title data-server-head>&quot;&gt;&lt;script&gt;x&lt;/script&gt;</title>");
    expect(head).toContain('<meta property="og:description" content="a &amp; b" data-server-head>');
    expect(head).toContain('<meta name="twitter:image:alt" content="&lt;img&gt;" data-server-head>');
  });

  it("gives the image's size and type, so previews can lay it out before it loads", () => {
    const head = renderPageHead({ page: pageWith(), origin: ORIGIN });

    expect(head).toContain('<meta property="og:image:width" content="1200" data-server-head>');
    expect(head).toContain('<meta property="og:image:height" content="630" data-server-head>');
    expect(head).toContain('<meta property="og:image:type" content="image/png" data-server-head>');
  });
});

describe("createPageTemplate", () => {
  it("puts the head tags at the end of the head, after taking out the defaults", () => {
    const page = createPageTemplate(
      '<html><head><meta charset="UTF-8"><meta\n  name="description"\n  content="old"\n  data-server-head\n/><title data-server-head="">Old</title></head><body></body></html>',
    );

    expect(page("<title>New</title>")).toBe(
      '<html><head><meta charset="UTF-8">  <title>New</title>\n  </head><body></body></html>',
    );
  });

  it("refuses a build without a head to write into", () => {
    expect(() => createPageTemplate("<div id=root></div>")).toThrow(/no <\/head>/);
  });
});
