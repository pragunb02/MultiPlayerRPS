import { useCallback, useEffect, useRef, useState } from "react";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/** Whether the player has an account. Friends need one (CC-052): a guest is shown how to save their progress. */
const isAccount = (identity) => identity?.kind === "user";

/** A friend's new presence, put into the view the tab already has. */
const withPresence = (view, { handle, presence }) => ({
  ...view,
  friends: view.friends.map((friend) => (friend.handle === handle ? { ...friend, presence } : friend)),
});

/**
 * Reads the friends view and hands it on, then reads it again while a push came during the read (see useFriends).
 *
 * @param {{
 *   getFriends: () => Promise<object>,
 *   reading: { current: number },
 *   missed: { current: boolean },
 *   stillFor: () => boolean,
 *   onView: (view: object) => void,
 * }} options  `reading` counts the reads on their way, `missed` says a push came meanwhile
 */
async function readAgainAfterPushes({ getFriends, reading, missed, stillFor, onView }) {
  let again = true;
  while (again) {
    reading.current += 1;
    let view;
    try {
      view = await getFriends();
    } finally {
      reading.current -= 1;
    }
    if (!stillFor()) return;
    onView(view);
    again = missed.current && reading.current === 0;
    if (again) missed.current = false;
  }
}

/**
 * The player's friends (CC-052): the view from `GET /api/friends`, kept current by the server's pushes, and the
 * things a player does with it. Each change also comes back as a push to every tab, so a second tab follows along.
 * A guest gets `status: "guest"`, someone with no session at all `status: "visitor"`, and neither asks the server
 * anything. Loads again whenever the player becomes someone else.
 *
 * A push can overtake an answer the server wrote a moment before it, which would then show the older state. So a
 * push that arrives while the view is being read makes the hook read it once more after.
 *
 * @returns {{
 *   status: "loading" | "visitor" | "guest" | "ready" | "error",
 *   view: { friends: object[], incoming: object[], outgoing: object[], settings: { appearOffline: boolean }, safetyTips: boolean } | undefined,
 *   error: Error | undefined,
 *   retry: () => void,
 *   answer: (requestId: string, answer: "accept" | "decline") => Promise<void>,
 *   cancel: (requestId: string) => Promise<void>,
 *   remove: (handle: string) => Promise<void>,
 *   setAppearOffline: (appearOffline: boolean) => Promise<void>,
 * }}
 */
export function useFriends() {
  const { api, socket } = useServices();
  const session = useSession();
  const { identity } = session;
  const account = isAccount(identity);
  const who = identity?.id ?? "";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ who: "", status: "loading", view: undefined, error: undefined });
  // Reads of the view still on their way, and whether a push came while one was.
  const reading = useRef(0);
  const missed = useRef(false);

  /** Reads the view for `who`, and once more when a push came meanwhile. Stops when it is for someone else now. */
  const read = useCallback(
    (stillFor) =>
      readAgainAfterPushes({
        getFriends: api.getFriends,
        reading,
        missed,
        stillFor,
        onView: (view) => setState({ who, status: "ready", view, error: undefined }),
      }),
    [api, who],
  );

  useEffect(() => {
    if (!account) return undefined;
    let cancelled = false;
    read(() => !cancelled).catch(
      (error) => !cancelled && setState({ who, status: "error", view: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [read, who, account, attempt]);

  useEffect(() => {
    const pushed = (change) => {
      if (reading.current > 0) missed.current = true;
      setState((current) =>
        current.who === who && current.status === "ready"
          ? { ...current, view: change(current.view) }
          : current,
      );
    };
    const unsubscribers = [
      socket.on(SOCKET_EVENTS.FRIENDS_UPDATED, (view) => pushed(() => view)),
      socket.on(SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED, (change) =>
        pushed((view) => withPresence(view, change)),
      ),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [socket, who]);

  /** Runs a change, then reads the view again, so this tab shows it even if its push is late. */
  const changing = useCallback(
    (change) =>
      async (...args) => {
        await change(...args);
        await read(() => true);
      },
    [read],
  );
  const retry = useCallback(() => {
    setState({ who, status: "loading", view: undefined, error: undefined });
    setAttempt((n) => n + 1);
  }, [who]);

  // Without a player the session decides: still loading, or a visitor with no session at all (CC-324: this used to
  // stay "loading" for ever).
  const withoutAccount = () => {
    if (identity !== undefined) return "guest";
    return session.status === "loading" ? "loading" : "visitor";
  };
  const current = !account
    ? { status: withoutAccount(), view: undefined, error: undefined }
    : state.who === who
      ? state
      : { status: "loading", view: undefined, error: undefined };
  return {
    status: current.status,
    view: current.view,
    error: current.error,
    retry,
    answer: changing((requestId, reply) => api.answerFriendRequest(requestId, reply)),
    cancel: changing((requestId) => api.cancelFriendRequest(requestId)),
    remove: changing((handle) => api.removeFriend(handle)),
    setAppearOffline: changing((appearOffline) => api.setAppearOffline(appearOffline)),
  };
}

/**
 * Asks someone the player just played with to be friends (CC-052), by their seat in a room or a past match, never by
 * player id.
 *
 * @returns {(target: { roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number }) => Promise<"sent" | "friends">}
 */
export function useAddFriend() {
  const { api } = useServices();
  return useCallback((target) => api.sendFriendRequest(target), [api]);
}

/**
 * Makes a new one-use friend link (CC-052). Its token is answered once, here.
 *
 * @returns {() => Promise<{ token: string, expiresAt: number }>}
 */
export function useMakeFriendLink() {
  const { api } = useServices();
  return useCallback(() => api.makeFriendLink(), [api]);
}

/**
 * What a friend link's page shows (CC-052), loaded again for another token. Reading it never uses the link up:
 * `use` does, when the player presses Add friend.
 *
 * @param {string} token
 * @returns {{
 *   status: "loading" | "ready" | "gone" | "error",
 *   invite: { displayName: string, avatar?: string, own?: true } | undefined,
 *   error: Error | undefined,
 *   use: () => Promise<"sent" | "friends">,
 * }}
 */
export function useFriendLink(token) {
  const { api } = useServices();
  const [state, setState] = useState({ token: "", status: "loading", invite: undefined, error: undefined });

  useEffect(() => {
    let cancelled = false;
    api.getFriendLink(token).then(
      (invite) => !cancelled && setState({ token, status: "ready", invite, error: undefined }),
      (error) =>
        !cancelled &&
        setState({
          token,
          status: error.code === ERROR_CODES.NOT_FOUND ? "gone" : "error",
          invite: undefined,
          error,
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, token]);

  const use = useCallback(() => api.useFriendLink(token), [api, token]);
  const { status, invite, error } =
    state.token === token ? state : { status: "loading", invite: undefined, error: undefined };
  return { status, invite, error, use };
}
