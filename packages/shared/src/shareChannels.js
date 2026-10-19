/**
 * How a shared link left our share buttons (CC-279). Every link the share buttons build carries one of these in its
 * `via` parameter, so the k-factor can count players who arrive by a shared link (EVENTS.md section 4). The value
 * names a channel and never a person: no player, session, device or share id (ADR-034.1).
 *
 * Shared, so the web app that adds and reads the marker and the server that will check it agree on one list.
 */

/** The query parameter that carries the channel. */
export const SHARE_CHANNEL_PARAM = "via";

/** The channels, one per kind of share button. */
export const SHARE_CHANNELS = Object.freeze({
  /** The "Send on WhatsApp" link. */
  WHATSAPP: "wa",
  /** The device's own share sheet. */
  SHARE_SHEET: "share",
  /** Copied to the clipboard, or the link shown in the invite box. */
  COPY: "copy",
});

const CHANNEL_VALUES = Object.freeze(Object.values(SHARE_CHANNELS));

/** The landing `entry` of a visit that arrived by a link with a valid channel (EVENTS.md section 3.1). */
export const SHARED_LINK_ENTRY = "shared_link";

/**
 * Whether a value is one of the channels. Anything else, an id included, is not.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isShareChannel = (value) => typeof value === "string" && CHANNEL_VALUES.includes(value);
