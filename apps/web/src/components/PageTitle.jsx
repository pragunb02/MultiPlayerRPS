import { useLocation } from "react-router";
import { describePage, SITE_NAME } from "@classicade/shared";

/**
 * The browser tab title for the current page, and the head tags search engines read: a description, and either
 * the canonical URL (pages worth listing) or a request not to list it (rooms, account pages, old URLs).
 * React 19 moves `<title>`, `<meta>` and `<link>` into the document head wherever they are rendered, so each page
 * names itself. The description comes from the shared page list, the same one the server writes into the HTML
 * for crawlers that never run this script (CC-047).
 *
 * @param {{ children?: string }} props  page name, omitted on the home page
 */
export function PageTitle({ children }) {
  const { pathname } = useLocation();
  const page = describePage(pathname);
  return (
    <>
      <title>{children ? `${children} · ${SITE_NAME}` : SITE_NAME}</title>
      <meta name="description" content={page.description} />
      {page.indexable ? (
        <link rel="canonical" href={new URL(page.path, window.location.origin).href} />
      ) : (
        <meta name="robots" content="noindex" />
      )}
    </>
  );
}
