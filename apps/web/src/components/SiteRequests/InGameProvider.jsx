import { useMemo, useState } from "react";
import { InGameContext } from "./inGameContext.js";

/**
 * Holds whether the player is in a game on the room page (CC-207), for the requests that must wait for it.
 *
 * @param {{ children: import("react").ReactNode }} props
 */
export function InGameProvider({ children }) {
  const [inGame, setInGame] = useState(false);
  const value = useMemo(() => ({ inGame, setInGame }), [inGame]);
  return <InGameContext.Provider value={value}>{children}</InGameContext.Provider>;
}
