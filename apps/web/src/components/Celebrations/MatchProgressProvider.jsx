import { useEffect, useEffectEvent, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { useSession } from "../../hooks/useSession.js";
import { keepMatchUpdate, MatchProgressContext } from "./matchProgressContext.js";

const NONE = Object.freeze([]);
const NOTHING_KEPT = Object.freeze({ owner: undefined, updates: NONE });

/**
 * Keeps the last progress update of each recent match for the whole app, so a game's result shows its XP and why it
 * didn't count even when the update came before the result was on screen. The server records the match in the
 * background, so nothing says which of the finished room and its update arrives first (CC-235). The updates belong
 * to whoever is signed in: after a sign in or sign out they are gone, so nobody sees another person's XP.
 */
export function MatchProgressProvider({ children }) {
  const { socket } = useServices();
  const session = useSession();
  const owner = session.identity?.id;
  const [kept, setKept] = useState(NOTHING_KEPT);

  const onProgress = useEffectEvent((update) =>
    setKept((current) => ({
      owner,
      updates: keepMatchUpdate(current.owner === owner ? current.updates : NONE, update),
    })),
  );

  // Mounted with the app, so it listens long before any game ends.
  useEffect(() => socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, (update) => onProgress(update)), [socket]);

  const updates = kept.owner === owner ? kept.updates : NONE;
  return <MatchProgressContext.Provider value={updates}>{children}</MatchProgressContext.Provider>;
}
