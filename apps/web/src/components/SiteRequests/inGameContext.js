import { createContext, useContext, useEffect } from "react";

/**
 * Whether the player is in a game on the room page right now (CC-207). While they are, nothing from elsewhere
 * interrupts them: popups, their sound and the tab alert wait until the game ends. Provided by <InGameProvider>,
 * which the layout puts around every page.
 */
export const InGameContext = createContext(null);

function useInGameState() {
  const state = useContext(InGameContext);
  if (state === null) {
    throw new Error("in-game state must be used inside <InGameProvider>");
  }
  return state;
}

/** @returns {boolean} whether the player is in a game on this page */
export const useInGame = () => useInGameState().inGame;

/**
 * The room page says whether a game of the player's is on. Leaving the page says it is not.
 *
 * @param {boolean} playing
 */
export function useMarkInGame(playing) {
  const { setInGame } = useInGameState();
  useEffect(() => {
    setInGame(playing);
    return () => setInGame(false);
  }, [playing, setInGame]);
}
