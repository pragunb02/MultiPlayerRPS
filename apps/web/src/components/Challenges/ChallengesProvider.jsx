import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHALLENGE_LIFETIME_MS, CHALLENGE_STATES, SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { useSession } from "../../hooks/useSession.js";
import { ChallengesContext } from "./challengesContext.js";

const EMPTY = Object.freeze({ who: "", byId: Object.freeze({}) });

/**
 * Whether a view still means something at `now`: an open challenge until it expires, and a taken one of the
 * player's while the server says its room waits (`until`). The server's views carry no time from which a blocked
 * player could tell their age, so the times here are only these two (ADR-069).
 */
const endOf = (challenge) =>
  Math.min(
    challenge.state === CHALLENGE_STATES.OPEN ? challenge.expiresAt : Infinity,
    challenge.until ?? Infinity,
  );
const isLive = (challenge, now) => endOf(challenge) > now;

/**
 * When a challenge was made, for the order of the list. Only its creator is told `createdAt`, and an open one
 * expires a day after it was made.
 */
const madeAt = (challenge) => challenge.createdAt ?? (challenge.expiresAt ?? 0) - CHALLENGE_LIFETIME_MS;

/** What the tab knows about `who`'s challenges. Nothing it knew about another player counts. */
const knownFor = (state, who) => (state.who === who ? state.byId : {});

/**
 * Keeps the player's challenges for the inbox and the popups (CC-139, CC-207). The inbox is read when a player is
 * known and every time the socket connects again, because a tab that was offline may have missed pushes. Each
 * `challenge:updated` push replaces what the tab knew about that challenge. A push that arrives while a read is on
 * its way is newer than the read, so the read never undoes it. A failed read keeps what the tab already had: the
 * next connection reads again, and nothing here is needed to play.
 *
 * @param {{ children: import("react").ReactNode }} props
 */
export function ChallengesProvider({ children }) {
  const { api, socket } = useServices();
  const { identity } = useSession();
  const who = identity?.id ?? "";
  const [state, setState] = useState(EMPTY);
  const [now, setNow] = useState(() => Date.now());
  // The views this tab got since the last read of the inbox began. They are newer than what that read answers.
  const sinceRead = useRef(new Map());
  const known = knownFor(state, who);
  // The tab looks again the moment the next challenge's time is up, so the inbox never offers one that has gone.
  const nextEnd = Math.min(
    ...Object.values(known)
      .map(endOf)
      .filter((end) => end > now),
  );
  useEffect(() => {
    if (nextEnd === Infinity) return undefined;
    // A timer may fire a moment early, so the moment it stands for is never earlier than the end it waited for.
    const timer = setTimeout(() => setNow(Math.max(Date.now(), nextEnd)), Math.max(0, nextEnd - Date.now()));
    return () => clearTimeout(timer);
  }, [nextEnd]);

  /** Keeps one view, the newest the tab got from a push or an answer. */
  const remember = useCallback(
    (challenge) => {
      sinceRead.current.set(challenge.id, challenge);
      setState((current) => ({ who, byId: { ...knownFor(current, who), [challenge.id]: challenge } }));
    },
    [who],
  );

  useEffect(() => {
    if (who === "") return undefined;
    let cancelled = false;
    // The list replaces what the tab knew, except what the tab heard while the list was on its way.
    const load = () => {
      sinceRead.current = new Map();
      return api.getChallenges().then(
        (list) =>
          !cancelled &&
          setState({
            who,
            byId: {
              ...Object.fromEntries(list.map((challenge) => [challenge.id, challenge])),
              ...Object.fromEntries(sinceRead.current),
            },
          }),
        () => undefined,
      );
    };
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
        Object.values(known)
          .filter((challenge) => isLive(challenge, now))
          .sort((a, b) => madeAt(b) - madeAt(a)),
      ),
      later,
      remember,
    }),
    [known, now, later, remember],
  );

  return <ChallengesContext.Provider value={value}>{children}</ChallengesContext.Provider>;
}
