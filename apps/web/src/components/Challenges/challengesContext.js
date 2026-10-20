import { createContext, useContext } from "react";

/**
 * The player's challenges as the inbox knows them (CC-139, CC-207): loaded when they connect, then kept current by
 * the server's pushes. Provided by <ChallengesProvider>, which the layout puts around every page.
 */
export const ChallengesContext = createContext(null);

/**
 * @returns {{
 *   challenges: ReadonlyArray<Readonly<object>>,  the views the server sent, newest first
 *   later: (id: string) => void,                  moves one from its popup to the inbox, on every tab
 *   remember: (challenge: object) => void,         keeps a view this tab got as an answer
 * }}
 */
export function useChallengeInbox() {
  const inbox = useContext(ChallengesContext);
  if (inbox === null) {
    throw new Error("useChallengeInbox must be used inside <ChallengesProvider>");
  }
  return inbox;
}
