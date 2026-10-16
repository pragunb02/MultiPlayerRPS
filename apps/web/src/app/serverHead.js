/** Marks the head tags the server wrote for one page (apps/server/src/service/http/pageHead.js). */
export const SERVER_HEAD_ATTRIBUTE = "data-server-head";

/**
 * Removes the head tags the server wrote into the page it sent. They describe only the first page, for crawlers
 * that never run scripts. Once the app runs, every page renders its own (PageTitle), and leftovers would describe
 * the wrong page after the first navigation.
 *
 * @param {Document} document
 */
export function removeServerHead(document) {
  for (const element of document.head.querySelectorAll(`[${SERVER_HEAD_ATTRIBUTE}]`)) {
    element.remove();
  }
}
