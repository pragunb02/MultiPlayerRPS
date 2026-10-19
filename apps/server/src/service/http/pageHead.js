import { PREVIEW_IMAGE, PUBLIC_PAGE_PATHS, SITE_NAME, SITE_ORIGIN_META } from "@classicade/shared";

/** Marks the tags written here, so the web app can remove them once it runs (apps/web/src/app/serverHead.js). */
const MARK = "data-server-head";

// The default tags of the built index.html, which these replace. Written by apps/web/index.html.
const DEFAULT_HEAD = new RegExp(`<title ${MARK}[^>]*>[^<]*</title>|<meta\\b[^>]*\\b${MARK}\\b[^>]*>`, "g");

const ESCAPES = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });

/**
 * Makes text safe inside HTML, in element content and in quoted attribute values alike.
 *
 * @param {string} text
 */
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);

const meta = (key, name, content) => `<meta ${key}="${name}" content="${escapeHtml(content)}" ${MARK}>`;

/** The preview image types we draw, by file extension. `og:image:type` must name the file's real type. */
const IMAGE_TYPES = Object.freeze({ ".jpg": "image/jpeg", ".png": "image/png" });

/** The type of a preview image, from its file name. */
function imageType(imagePath) {
  const extension = imagePath.slice(imagePath.lastIndexOf("."));
  if (!Object.hasOwn(IMAGE_TYPES, extension)) {
    throw new Error(`No preview image type for ${imagePath}`);
  }
  return IMAGE_TYPES[extension];
}

/**
 * The head tags of one page for crawlers and link previews, which read the HTML without running scripts: the
 * title, the description, the canonical URL or a request not to list the page, Open Graph and Twitter card tags.
 * Last comes the site's own address, which the web app puts in the links it shares. It comes from the server's
 * settings, never from the request, so a request with a forged Host header cannot change a shared link.
 *
 * @param {{ page: Readonly<import("@classicade/shared").PageInfo>, origin: string }} options
 *   origin: the site's own address, e.g. https://classicade.example, since previews need absolute URLs
 * @returns {string}
 */
export function renderPageHead({ page, origin }) {
  const url = new URL(page.path, origin).href;
  const image = new URL(page.image, origin).href;
  return [
    `<title ${MARK}>${escapeHtml(page.title)}</title>`,
    meta("name", "description", page.description),
    page.indexable
      ? `<link rel="canonical" href="${escapeHtml(url)}" ${MARK}>`
      : meta("name", "robots", "noindex"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:type", "website"),
    meta("property", "og:title", page.title),
    meta("property", "og:description", page.description),
    meta("property", "og:url", url),
    meta("property", "og:image", image),
    meta("property", "og:image:type", imageType(page.image)),
    meta("property", "og:image:width", String(PREVIEW_IMAGE.width)),
    meta("property", "og:image:height", String(PREVIEW_IMAGE.height)),
    meta("property", "og:image:alt", page.imageAlt),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", page.title),
    meta("name", "twitter:description", page.description),
    meta("name", "twitter:image", image),
    meta("name", "twitter:image:alt", page.imageAlt),
    `<meta name="${SITE_ORIGIN_META}" content="${escapeHtml(new URL(origin).origin)}">`,
  ].join("\n    ");
}

// The places in the body of the built index.html that carry the page's own title and description, for crawlers
// that read the body text. Written by apps/web/index.html, inside the screen that shows while the app loads.
const BODY_SLOT = /(<(\w+)\b[^>]*\bdata-server-body="(title|description)"[^>]*>)[^<]*(<\/\2>)/g;
const BODY_SLOTS = Object.freeze(["title", "description"]);

/**
 * Prepares the built index.html once, so each page costs one string join. The default title and description are
 * taken out of the head, and each request puts its own page's tags in their place at the end of the head. The
 * page's title and description also go into the body, because crawlers that run no scripts read the body text as
 * what the page is about, and they must not read only the words of the loading screen.
 *
 * @param {string} html  the built index.html
 * @returns {(page: { head: string, title: string, description: string }) => string}
 *   head: the page's head tags, already HTML. title, description: plain text, escaped here.
 * @throws {Error} when the file has no head to write into, or not exactly one place in the body for the title
 *   and one for the description, a broken build that must not go live
 */
export function createPageTemplate(html) {
  const end = html.indexOf("</head>");
  if (end === -1) {
    throw new Error("The web app's index.html has no </head>");
  }
  const before = html.slice(0, end).replace(DEFAULT_HEAD, "");
  const body = html.slice(end);
  const slots = [...body.matchAll(BODY_SLOT)];
  const names = slots.map((slot) => slot[3]).sort();
  if (names.join() !== [...BODY_SLOTS].sort().join()) {
    throw new Error("The web app's index.html needs one data-server-body title and one description");
  }
  // The body cut into the text around the slots: text, slot, text, slot, text.
  const pieces = [];
  let from = 0;
  for (const slot of slots) {
    const [whole, open, , name, close] = slot;
    pieces.push(body.slice(from, slot.index) + open, name);
    from = slot.index + whole.length - close.length;
  }
  pieces.push(body.slice(from));
  return ({ head, title, description }) => {
    const text = { title, description };
    const filled = pieces.map((piece, index) => (index % 2 === 1 ? escapeHtml(text[piece]) : piece));
    return `${before}  ${head}\n  ${filled.join("")}`;
  };
}

/**
 * robots.txt: everything but the API may be crawled. Rooms are not blocked here, because some link preview bots
 * obey robots.txt and would then show no preview for an invite. Rooms ask not to be listed in their own head.
 *
 * @param {{ origin: string }} options
 */
export function renderRobots({ origin }) {
  return [
    "User-agent: *",
    "Disallow: /api/",
    "",
    `Sitemap: ${new URL("/sitemap.xml", origin).href}`,
    "",
  ].join("\n");
}

/**
 * sitemap.xml: the pages search engines should list (home, game lobbies, leaderboards, legal pages), never rooms.
 *
 * @param {{ origin: string }} options
 */
export function renderSitemap({ origin }) {
  const urls = PUBLIC_PAGE_PATHS.map(
    (path) => `  <url><loc>${escapeHtml(new URL(path, origin).href)}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
