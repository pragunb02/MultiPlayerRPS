import { describe, expect, it } from "vitest";
import { describePage, PUBLIC_PAGE_PATHS } from "@classicade/shared";
import { createPageTemplate, escapeHtml, renderPageHead } from "./pageHead.js";

const ORIGIN = "https://classicade.example";

/** A page as the shared page list describes one, with text a test can choose. */
const pageWith = (fields = {}) => ({
  found: true,
  title: "Title",
  description: "Description",
  path: "/games/chess",
  indexable: true,
  image: "/og/chess.1a2b3c4d.jpg",
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
    expect(head).toContain('<meta property="og:image:type" content="image/jpeg" data-server-head>');
  });

  it("names the type the image file has", () => {
    const head = renderPageHead({ page: pageWith({ image: "/og/chess.png" }), origin: ORIGIN });

    expect(head).toContain('<meta property="og:image:type" content="image/png" data-server-head>');
  });

  it("refuses an image of a type it cannot name", () => {
    expect(() => renderPageHead({ page: pageWith({ image: "/og/chess.gif" }), origin: ORIGIN })).toThrow(
      /preview image type/,
    );
  });

  it("writes the site's own address for the app, which builds share links from it (CC-217)", () => {
    const head = renderPageHead({ page: pageWith(), origin: ORIGIN });

    expect(head).toContain(`<meta name="classicade:site-origin" content="${ORIGIN}">`);
  });
});

/** The content of a head tag, read from the rendered head. */
const tagIn = (head, attribute, name) =>
  head.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`))?.[1];

// WhatsApp's rules for a link preview (https://developers.facebook.com/docs/whatsapp/link-previews): og:title,
// og:description and og:url present, og:image an absolute URL at least 300 px wide with a ratio of at most 4 to 1.
describe("every page's preview follows WhatsApp's rules", () => {
  const PATHS = [...PUBLIC_PAGE_PATHS, "/games/chess/rooms/AB2CD3", "/room/AB2CD3", "/login"];

  it.each(PATHS)("%s", (path) => {
    const head = renderPageHead({ page: describePage(path), origin: ORIGIN });

    for (const name of ["og:title", "og:description", "og:url"]) {
      expect(tagIn(head, "property", name), name).toMatch(/\S/);
    }
    const image = new URL(tagIn(head, "property", "og:image"));
    expect(image.origin).toBe(ORIGIN);
    expect(image.pathname).toMatch(/^\/og\/[a-z-]+\.[0-9a-f]{8}\.jpg$/);
    expect(tagIn(head, "property", "og:image:type")).toBe("image/jpeg");
    const width = Number(tagIn(head, "property", "og:image:width"));
    const height = Number(tagIn(head, "property", "og:image:height"));
    expect(width).toBeGreaterThanOrEqual(300);
    expect(width / height).toBeLessThanOrEqual(4);
  });
});

describe("createPageTemplate", () => {
  const BODY =
    '<body><h1 data-server-body="title">Old</h1><p class="x" data-server-body="description">old</p></body>';
  const page = (fields = {}) => ({ head: "<title>New</title>", title: "T", description: "D", ...fields });

  it("puts the head tags at the end of the head, after taking out the defaults", () => {
    const template = createPageTemplate(
      `<html><head><meta charset="UTF-8"><meta\n  name="description"\n  content="old"\n  data-server-head\n/><title data-server-head="">Old</title></head>${BODY}</html>`,
    );

    expect(template(page())).toBe(
      '<html><head><meta charset="UTF-8">  <title>New</title>\n  </head><body><h1 data-server-body="title">T</h1><p class="x" data-server-body="description">D</p></body></html>',
    );
  });

  it("puts the page's title and description in the body, escaped, whichever comes first", () => {
    const template = createPageTemplate(
      '<head></head><p data-server-body="description">old</p><h1 data-server-body="title">Old</h1>',
    );

    expect(template(page({ title: "<b>Chess</b>", description: "Rock & roll" }))).toContain(
      '<p data-server-body="description">Rock &amp; roll</p><h1 data-server-body="title">&lt;b&gt;Chess&lt;/b&gt;</h1>',
    );
  });

  it("refuses a build without a head to write into", () => {
    expect(() => createPageTemplate(`<div id=root></div>`)).toThrow(/no <\/head>/);
  });

  it.each([
    ["no places in the body", "<head></head><body></body>"],
    ["no place for the description", '<head></head><h1 data-server-body="title">Old</h1>'],
    [
      "two places for the title",
      '<head></head><h1 data-server-body="title">A</h1><h1 data-server-body="title">B</h1>',
    ],
  ])("refuses a build with %s", (_, html) => {
    expect(() => createPageTemplate(html)).toThrow(/data-server-body/);
  });
});
