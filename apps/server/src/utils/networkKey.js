import { createHmac } from "node:crypto";

const KEY_LENGTH = 16;

/**
 * Names a network address without storing it. Rooms keep the name, so the rooms opened from one network can be
 * counted (CC-107), while the database never holds anyone's address. A keyed hash is used because there are few
 * enough addresses that a plain hash could be reversed by trying them all.
 *
 * @param {{ secret: string }} options  the server's session secret, so the names mean nothing outside this server
 * @returns {(address: string) => string} a short hex name, the same for the same address
 */
export function createNetworkKey({ secret }) {
  if (typeof secret !== "string" || secret === "") {
    throw new TypeError("createNetworkKey needs a secret");
  }
  return (address) => createHmac("sha256", secret).update(address).digest("hex").slice(0, KEY_LENGTH);
}
