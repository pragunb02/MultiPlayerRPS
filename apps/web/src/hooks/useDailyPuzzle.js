import { useCallback, useEffect, useRef, useState } from "react";
import { DAILY_PUZZLE_REFUSALS, ERROR_CODES } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { AppRequestError } from "../lib/errors.js";
import { useSession } from "./useSession.js";

const LOADING = Object.freeze({ status: "loading", puzzle: undefined, error: undefined });

/** Refusals after which the page's copy of the puzzle is out of date: a new day, another tab, an ended attempt. */
const STALE = new Set([
  DAILY_PUZZLE_REFUSALS.DAY_OVER,
  DAILY_PUZZLE_REFUSALS.CHANGED,
  DAILY_PUZZLE_REFUSALS.FINISHED,
]);
const isStale = (error) =>
  error instanceof AppRequestError && error.code === ERROR_CODES.CONFLICT && STALE.has(error.details?.reason);

/**
 * Today's daily puzzle of a kind (CC-144): loaded once the session is known, and again when the player changes
 * (signing in brings a guest's attempt along). A visitor sees the puzzle too. The first move or hint starts a guest
 * session, and the page keeps the answer it got instead of loading again. A refusal that means the page is out of
 * date (a new day, another tab) loads the puzzle again and is still thrown, so the button can say what happened.
 *
 * @param {string} kind  a DAILY_PUZZLE_KINDS value
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   puzzle: any,
 *   error: Error | undefined,
 *   reload: () => void,
 *   play: (move: object) => Promise<any>,
 *   hint: () => Promise<any>,
 * }}
 */
export function useDailyPuzzle(kind) {
  const { api } = useServices();
  const session = useSession();
  const [state, setState] = useState(LOADING);
  const [loads, setLoads] = useState(0);
  // The guest this page started with the player's first press. Its answer already holds the attempt.
  const startedHere = useRef("");
  const settled = session.status !== "loading";
  const playerId = session.identity?.id ?? "";

  useEffect(() => {
    if (!settled) {
      return undefined;
    }
    if (playerId !== "" && playerId === startedHere.current) {
      startedHere.current = "";
      return undefined;
    }
    let cancelled = false;
    api.getDailyPuzzle(kind).then(
      (puzzle) => !cancelled && setState({ status: "ready", puzzle, error: undefined }),
      (error) => !cancelled && setState({ status: "error", puzzle: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, kind, settled, playerId, loads]);

  const reload = useCallback(() => setLoads((count) => count + 1), []);

  /** Runs a request as a player, starting a guest session first for a visitor. */
  const asPlayer = useCallback(
    async (request) => {
      const identity = await session.ensurePlayer();
      if (identity.id !== playerId) {
        startedHere.current = identity.id;
      }
      try {
        const answer = await request();
        setState({ status: "ready", puzzle: answer.puzzle, error: undefined });
        return answer;
      } catch (error) {
        if (isStale(error)) reload();
        throw error;
      }
    },
    [session, playerId, reload],
  );

  const day = state.puzzle?.day ?? "";
  const play = useCallback(
    (move) => asPlayer(() => api.playDailyMove(kind, { day, ...move })),
    [asPlayer, api, kind, day],
  );
  const hint = useCallback(
    () => asPlayer(() => api.takeDailyHint(kind, { day })),
    [asPlayer, api, kind, day],
  );

  return { ...state, reload, play, hint };
}
