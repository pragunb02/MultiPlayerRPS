import { createHmac, randomBytes } from "node:crypto";

const NAME_LENGTH = 16;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Names a network address without storing it. Rooms keep the name, so the rooms opened from one network can be
 * counted (CC-107), while the database never holds anyone's address.
 *
 * There are few enough addresses that anyone holding the key could hash every one of them and find the address
 * behind a name. So the key is 32 random bytes made in this process for each UTC day, never written anywhere, and
 * dropped when the next day starts. Once a day is over, nobody can turn that day's names back into addresses, not
 * from the database, a backup or any of the server's settings (CC-249). The price is that a restart or midnight
 * gives an address a new name, so rooms still open from before stop counting for the cap per network. Those rooms
 * close within a day, and the other limits still hold meanwhile.
 *
 * @param {{ now: () => number, randomKey?: () => Buffer }} options  `now` is the server clock. `randomKey` makes a
 *   day's key, and tests replace it to see when a new one is made
 * @returns {(address: string) => string} a short hex name, the same for the same address on the same UTC day
 */
export function createNetworkKey({ now, randomKey = () => randomBytes(32) }) {
  if (typeof now !== "function") {
    throw new TypeError("createNetworkKey needs a clock");
  }
  let keyDay = Number.NaN;
  let key = Buffer.alloc(0);
  return (address) => {
    const today = Math.floor(now() / DAY_MS);
    if (today !== keyDay) {
      key = randomKey();
      keyDay = today;
    }
    return createHmac("sha256", key).update(address).digest("hex").slice(0, NAME_LENGTH);
  };
}
