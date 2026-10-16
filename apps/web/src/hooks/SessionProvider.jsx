import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServices } from "../app/servicesContext.js";
import { isUnauthorized } from "../lib/errors.js";
import { SessionContext } from "./useSession.js";

/**
 * Who the player is, for the whole app. Loads the session on start, and keeps the realtime connection bound to
 * it: the socket authenticates with the session cookie at connect time, so it reconnects whenever the identity
 * changes (guest → signed in → signed out) — and only then: the same identity again leaves a connecting socket alone.
 *
 * status: "loading" | "anonymous" | "ready" | "error"
 */
export function SessionProvider({ children }) {
  const { api, socket } = useServices();
  const [state, setState] = useState({ status: "loading", identity: undefined, error: undefined });

  const connectedAs = useRef(undefined);
  const pendingGuest = useRef(undefined);
  // Counts identity changes, so a slow first "who am I?" answer can't undo one that happened meanwhile.
  const changes = useRef(0);

  const adopt = useCallback(
    (identity) => {
      changes.current += 1;
      if (identity?.id !== connectedAs.current) {
        connectedAs.current = identity?.id;
        socket.disconnect();
        if (identity !== undefined) {
          socket.connect();
        }
      }
      setState({ status: identity === undefined ? "anonymous" : "ready", identity, error: undefined });
      return identity;
    },
    [socket],
  );

  useEffect(() => {
    let cancelled = false;
    const before = changes.current;
    // Stale when the page already became someone meanwhile (e.g. a room link started a guest session first).
    const stale = () => cancelled || changes.current !== before;
    api.getSession().then(
      (identity) => !stale() && adopt(identity),
      (err) => {
        if (stale()) return;
        if (isUnauthorized(err)) {
          adopt(undefined);
        } else {
          setState({ status: "error", identity: undefined, error: err });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, adopt]);

  const value = useMemo(() => {
    const signedIn = (result) => {
      adopt(result.identity);
      return result;
    };
    return {
      ...state,
      /** Ensures there is an identity to play with: keeps the current one, or starts a guest session. */
      // Pages may ask several times while the first guest session is being created; they all share that one.
      ensurePlayer: async () => {
        if (state.identity !== undefined) return state.identity;
        pendingGuest.current ??= api
          .startGuest()
          .then(adopt)
          .finally(() => {
            pendingGuest.current = undefined;
          });
        return pendingGuest.current;
      },
      // Both answer `{ identity, carriedOver? }`: what a guest's games brought to the account (CC-032).
      signup: async (credentials) => signedIn(await api.signup(credentials)),
      login: async (credentials) => signedIn(await api.login(credentials)),
      logout: async () => {
        await api.endSession();
        adopt(undefined);
      },
    };
  }, [state, api, adopt]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
