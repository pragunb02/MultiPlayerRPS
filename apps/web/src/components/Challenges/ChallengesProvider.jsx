import { useCallback, useEffect, useMemo, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { useSession } from "../../hooks/useSession.js";
import { ChallengesContext } from "./challengesContext.js";

const EMPTY = Object.freeze({ who: "", byId: Object.freeze({}) });

/** What the tab knows about `who`'s challenges. Nothing it knew about another player counts. */
const knownFor = (state, who) => (state.who === who ? state.byId : {});

/**
 * Keeps the player's challenges for the inbox and the popups (CC-139, CC-207). The inbox is read when a player is
 * known and every time the socket connects again, because a tab that was offline may have missed pushes. Each
 * `challenge:updated` push replaces what the tab knew about that challenge. A failed read keeps what the tab
 * already had: the next connection reads again, and nothing here is needed to play.
 *
 * @param {{ children: import("react").ReactNode }} props
 */
export function ChallengesProvider({ children }) {
  const { api, socket } = useServices();
  const { identity } = useSession();
  const who = identity?.id ?? "";
  const [state, setState] = useState(EMPTY);

  /** Keeps one view, the newest the tab got from a push or an answer. */
  const remember = useCallback(
    (challenge) =>
      setState((current) => {
        return { who, byId: { ...knownFor(current, who), [challenge.id]: challenge } };
      }),
    [who],
  );

  useEffect(() => {
    if (who === "") return undefined;
    let cancelled = false;
    // The list replaces what the tab knew.
    const load = () =>
      api.getChallenges().then(
        (list) =>
          !cancelled &&
          setState({ who, byId: Object.fromEntries(list.map((challenge) => [challenge.id, challenge])) }),
        () => undefined,
      );
    load();
    const unsubscribers = [
      socket.on("connect", load),
      socket.on(SOCKET_EVENTS.CHALLENGE_UPDATED, ({ challenge }) => remember(challenge)),
    ];
    return () => {
      cancelled = true;
      unsubscribers.forEach((off) => off());
    };
  }, [api, socket, who, remember]);

  // Only ever called for a challenge the tab shows, so it is always known here.
  const later = useCallback(
    (id) => {
      setState((current) => ({
        ...current,
        byId: { ...current.byId, [id]: { ...current.byId[id], later: true } },
      }));
      // Moving it is only about where it shows. If the server misses it, the popup comes back on the next page load.
      api.challengeLater(id).catch(() => undefined);
    },
    [api],
  );

  const value = useMemo(
    () => ({
      challenges: Object.freeze(
        Object.values(knownFor(state, who)).sort((a, b) => b.createdAt - a.createdAt),
      ),
      later,
      remember,
    }),
    [state, who, later, remember],
  );

  return <ChallengesContext.Provider value={value}>{children}</ChallengesContext.Provider>;
}
