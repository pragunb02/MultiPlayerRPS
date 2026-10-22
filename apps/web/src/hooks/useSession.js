import { createContext, useContext } from "react";

/** Who the player is, for the whole app. Provided by <SessionProvider> (hooks/SessionProvider.jsx). */
export const SessionContext = createContext(null);

/**
 * @typedef {{ identity: object, carriedOver?: { xp: number, matchesPlayed: number, matches: number } }} SignedIn
 *   `carriedOver`: what a guest's games brought to the account (CC-032)
 */

/**
 * @returns {{
 *   status: "loading" | "anonymous" | "ready" | "error",
 *   identity: { kind: string, id: string, displayName: string } | undefined,
 *   error: Error | undefined,
 *   ensurePlayer: () => Promise<object>,
 *   signup: (credentials: object) => Promise<SignedIn>,
 *   login: (credentials: object) => Promise<SignedIn>,
 *   logout: () => Promise<void>,
 *   recheck: () => void,
 * }}
 */
export function useSession() {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return session;
}
