import { createContext, useContext } from "react";

/** The match's polite announcer, set by MatchAnnouncer. Outside a match it is missing. */
export const AnnounceContext = createContext(undefined);

/**
 * Reads a message out politely to screen reader users in the match (CC-157). Only parts of the match frame may
 * use it: anywhere else is a mistake and fails at once.
 *
 * @returns {(text: string) => void}
 */
export function useAnnounce() {
  const announce = useContext(AnnounceContext);
  if (announce === undefined) {
    throw new Error("useAnnounce is only for parts of the match, inside MatchShell");
  }
  return announce;
}
