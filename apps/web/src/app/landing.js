import { isShareChannel, SHARE_CHANNEL_PARAM, SHARED_LINK_ENTRY } from "@classicade/shared";

/** A landing that did not come by one of our marked share links. */
const NOT_SHARED = Object.freeze({ entry: "", via: "" });

const pathOf = (url) => `${url.pathname}${url.search}${url.hash}`;

/**
 * The share channel an address carries (CC-279): the one `via` value when it is on the list, otherwise "". Two
 * markers, an empty one or any other value count as none, so nothing a person typed or an id is ever counted.
 *
 * @param {string} href  an absolute address
 * @returns {string} a `SHARE_CHANNELS` value, or ""
 */
export function shareChannelOf(href) {
  const values = new URL(href).searchParams.getAll(SHARE_CHANNEL_PARAM);
  return values.length === 1 && isShareChannel(values[0]) ? values[0] : "";
}

/**
 * Reads how this page load arrived, once, before the router reads the address (CC-279). A visit by one of our
 * marked share links is a `shared_link` landing of its channel. That is written on the page's root element
 * (`data-cc-entry`, `data-cc-via`) for the browser tests and for the telemetry client (CC-174), which sends it with
 * the landing `page_viewed`. Nothing is kept in web storage or sent from here.
 *
 * Then the marker leaves the address, valid or not, by replacing the history entry. A reload, a bookmark or a link
 * copied from the address bar then carries no marker, so one share is counted once and never passed on. An address
 * with no marker is left exactly as it is.
 *
 * @param {{ window: Pick<Window, "location" | "history">, document: Document }} deps
 * @returns {Readonly<{ entry: string, via: string }>} entry is `shared_link` or "", via the channel or ""
 */
export function takeLanding({ window, document }) {
  const address = new URL(window.location.href);
  if (!address.searchParams.has(SHARE_CHANNEL_PARAM)) {
    return NOT_SHARED;
  }
  const via = shareChannelOf(address.href);
  address.searchParams.delete(SHARE_CHANNEL_PARAM);
  // Replacing keeps the history entry and its state, so Back and Forward behave as if the marker was never there.
  window.history.replaceState(window.history.state, "", pathOf(address));
  if (via === "") {
    return NOT_SHARED;
  }
  document.documentElement.dataset.ccEntry = SHARED_LINK_ENTRY;
  document.documentElement.dataset.ccVia = via;
  return Object.freeze({ entry: SHARED_LINK_ENTRY, via });
}
