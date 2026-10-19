import { SITE_ORIGIN_META } from "@classicade/shared";

/**
 * The site's own address, for links a player shares (CC-217). The server writes it into every page from its
 * settings, the first allowed origin (ADR-042.3), never from the request. So a shared link always points at the
 * site's public address, even when the page was opened at another one the server also answers.
 *
 * A page the server did not send, such as one from the Vite dev server or a unit test, has no such tag. Then the
 * page's own address is the site's. A tag that is not an http or https address is not used.
 *
 * @param {{ document: Document, location: { origin: string } }} where
 * @returns {string} an origin such as https://classicade.example, with no path
 */
export function siteOriginOf({ document, location }) {
  const meta = document.head.querySelector(`meta[name="${SITE_ORIGIN_META}"]`);
  const content = meta?.getAttribute("content") ?? "";
  // URL.canParse rather than URL.parse, which older phone browsers lack.
  if (!URL.canParse(content)) {
    return location.origin;
  }
  const url = new URL(content);
  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : location.origin;
}

/** The site's own address, read from this page. */
export const siteOrigin = () => siteOriginOf({ document, location: window.location });
