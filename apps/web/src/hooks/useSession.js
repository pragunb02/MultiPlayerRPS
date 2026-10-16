import { createContext, useContext } from "react";

/** Who the player is, for the whole app. Provided by <SessionProvider> (hooks/SessionProvider.jsx). */
export const SessionContext = createContext(null);

/**
 * @returns {{
 *   status: "loading" | "anonymous" | "ready" | "error",
 *   identity: { kind: string, id: string, displayName: string } | undefined,
 *   error: Error | undefined,
 *   ensurePlayer: () => Promise<object>,
 *   signup: (credentials: object) => Promise<object>,
 *   login: (credentials: object) => Promise<object>,
 *   logout: () => Promise<void>,
 * }}
 */
export function useSession() {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return session;
}
