import { useCallback, useEffect, useMemo, useState } from "react";
import { useServices } from "../app/servicesContext.js";
import { isUnauthorized } from "../lib/errors.js";
import { SessionContext } from "./useSession.js";

/**
 * Who the player is, for the whole app. Loads the session on start, and keeps the realtime connection bound to
 * it: the socket authenticates with the session cookie at connect time, so it reconnects whenever the identity
 * changes (guest → signed in → signed out).
 *
 * status: "loading" | "anonymous" | "ready" | "error"
 */
export function SessionProvider({ children }) {
  const { api, socket } = useServices();
  const [state, setState] = useState({ status: "loading", identity: undefined, error: undefined });

  const adopt = useCallback(
    (identity) => {
      socket.disconnect();
      if (identity !== undefined) {
        socket.connect();
      }
      setState({ status: identity === undefined ? "anonymous" : "ready", identity, error: undefined });
      return identity;
    },
    [socket],
  );

  useEffect(() => {
    let cancelled = false;
    api.getSession().then(
      (identity) => !cancelled && adopt(identity),
      (err) => {
        if (cancelled) return;
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

  const value = useMemo(
    () => ({
      ...state,
      /** Ensures there is an identity to play with: keeps the current one, or starts a guest session. */
      ensurePlayer: async () => state.identity ?? adopt(await api.startGuest()),
      signup: async (credentials) => adopt(await api.signup(credentials)),
      login: async (credentials) => adopt(await api.login(credentials)),
      logout: async () => {
        await api.endSession();
        adopt(undefined);
      },
    }),
    [state, api, adopt],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
