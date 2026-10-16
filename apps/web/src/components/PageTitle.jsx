const SITE = "ClassiCade";

/**
 * The browser tab title for the current page. React 19 moves `<title>` into the document head wherever it is
 * rendered, so each page names itself.
 *
 * @param {{ children?: string }} props  page name; omitted on the home page
 */
export function PageTitle({ children }) {
  return <title>{children ? `${children} · ${SITE}` : SITE}</title>;
}
