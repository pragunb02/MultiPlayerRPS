import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServices } from "../app/servicesContext.js";
import { isUnauthorized } from "../lib/errors.js";
import { SessionContext } from "./useSession.js";

/**
 * Who the player is, for the whole app. Loads the session on start, and keeps the realtime connection bound to
 * it: the socket authenticates with the session cookie at connect time, so it reconnects whenever the identity
 * changes (guest → signed in → signed out) — and only then: the same identity again leaves a connecting socket alone.
 *
 * Every tab of the browser shows the same identity (ADR-033). The server is asked again when it ends this tab's
 * socket on purpose (signed out from another device, or another tab logged in or out, CC-234) and when another tab
 * says it changed the session (CC-115). After its own change this tab tells the other tabs, without saying who.
 *
 * status: "loading" | "anonymous" | "ready" | "error"
 */
export function SessionProvider({ children }) {
  const { api, socket, sessionBroadcast } = useServices();
  const [state, setState] = useState({ status: "loading", identity: undefined, error: undefined });

  const connectedAs = useRef(undefined);
  const pendingGuest = useRef(undefined);
  // Counts identity changes, so a slow first "who am I?" answer can't undo one that happened meanwhile.
  const changes = useRef(0);
  // The server ended the socket on purpose. Socket.IO does not reconnect after that, so the next identity this tab
  // takes connects it again, even when it is the same player (CC-234).
  const socketEnded = useRef(false);
  // This tab's own sign ups, log ins, log outs and guest starts on their way. Their answer decides who the tab is, so
  // a signal that arrives meanwhile is kept until they are done.
  const ownChanges = useRef(0);
  const heardMeanwhile = useRef(false);
  // The ask of the mounted app, set by the effect below. Empty once the app is gone, so nothing asks after that.
  const askAgain = useRef(undefined);
  // At most one "who am I?" request per tab at a time. A signal that arrives while one is on its way asks once more
  // when it is back, and that newer answer decides (CC-115). Otherwise an older "signed out" answer could land last.
  const asks = useRef({ inFlight: false, again: false });
  const askLatest = useCallback(() => askAgain.current?.(), []);

  const adopt = useCallback(
    (identity) => {
      changes.current += 1;
      if (identity?.id !== connectedAs.current || socketEnded.current) {
        socketEnded.current = false;
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

  /**
   * Asks the server who this browser is, unless a request is already on its way: then it asks once more after that
   * one. An answer is dropped when the tab changed identity meanwhile, or when a newer ask is waiting behind it.
   */
  const askServer = useCallback(
    (isGone) => {
      if (asks.current.inFlight) {
        asks.current.again = true;
        return;
      }
      asks.current.inFlight = true;
      const before = changes.current;
      const stale = () => isGone() || changes.current !== before || asks.current.again;
      api
        .getSession()
        .then(
          (identity) => !stale() && adopt(identity),
          (err) => {
            if (stale()) return;
            if (isUnauthorized(err)) {
              adopt(undefined);
            } else {
              setState({ status: "error", identity: undefined, error: err });
            }
          },
        )
        .finally(() => {
          asks.current.inFlight = false;
          if (asks.current.again) {
            asks.current.again = false;
            askLatest();
          }
        });
    },
    [api, adopt, askLatest],
  );

  useEffect(() => {
    let gone = false;
    const ask = () => askServer(() => gone);
    askAgain.current = ask;
    const askUnlessBusy = () => {
      if (ownChanges.current > 0) {
        heardMeanwhile.current = true;
      } else {
        ask();
      }
    };
    // On start. A stale answer is one that arrives after the page became someone (a room link starts a guest first).
    ask();
    const offs = [
      socket.onEndedByServer(() => {
        socketEnded.current = true;
        // During this tab's own change the server ending the old socket is expected, and the change's own answer
        // connects the new one. It is asked only if that change fails.
        if (ownChanges.current === 0) ask();
      }),
      sessionBroadcast.onChange(askUnlessBusy),
    ];
    return () => {
      gone = true;
      askAgain.current = undefined;
      offs.forEach((off) => off());
    };
  }, [askServer, socket, sessionBroadcast]);

  /** Runs one of this tab's own identity changes, then asks the server if something was heard meanwhile. */
  const own = useCallback(
    async (work) => {
      ownChanges.current += 1;
      try {
        return await work();
      } finally {
        ownChanges.current -= 1;
        if (ownChanges.current === 0 && (heardMeanwhile.current || socketEnded.current)) {
          heardMeanwhile.current = false;
          askLatest();
        }
      }
    },
    [askLatest],
  );

  const value = useMemo(() => {
    /** This tab became someone else: take the identity, then tell the other tabs to ask the server. */
    const changedTo = (identity) => {
      adopt(identity);
      sessionBroadcast.announce();
      return identity;
    };
    const signedIn = (result) => {
      changedTo(result.identity);
      return result;
    };
    return {
      ...state,
      /** Ensures there is an identity to play with: keeps the current one, or starts a guest session. */
      // Pages may ask several times while the first guest session is being created; they all share that one.
      ensurePlayer: async () => {
        if (state.identity !== undefined) return state.identity;
        pendingGuest.current ??= own(async () => changedTo(await api.startGuest())).finally(() => {
          pendingGuest.current = undefined;
        });
        return pendingGuest.current;
      },
      // Both answer `{ identity, carriedOver? }`: what a guest's games brought to the account (CC-032).
      signup: (credentials) => own(async () => signedIn(await api.signup(credentials))),
      login: (credentials) => own(async () => signedIn(await api.login(credentials))),
      logout: () =>
        own(async () => {
          await api.endSession();
          changedTo(undefined);
        }),
      // Both keep this browser signed in as the same player and sign out every other one (CC-116).
      changePassword: (passwords) => api.changePassword(passwords),
      signOutOtherDevices: () => api.signOutOtherDevices(),
    };
  }, [state, api, adopt, own, sessionBroadcast]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
