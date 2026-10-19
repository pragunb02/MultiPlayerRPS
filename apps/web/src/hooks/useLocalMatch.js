import { useCallback, useEffect, useMemo, useState } from "react";
import { createLocalMatch } from "../games/passAndPlay/localMatch.js";
import { AppRequestError } from "../lib/errors.js";

/** The phone's own clock. A local game has no server, so its clock is the only one (CC-223). */
const PHONE_CLOCK = Object.freeze({ now: () => Date.now() });
/** Who starts and the chess colours. Nothing rides on it, so the browser's own random numbers are enough. */
const PHONE_RNG = () => Math.random();

/**
 * One pass and play game on this phone (CC-223): the session, the RoomView the board draws, and the calls the shell
 * makes. A move is checked and applied by the game's engine right here, and nothing is sent anywhere. When the game
 * has a deadline, such as a chess flag, a timer applies it on time.
 *
 * @param {{
 *   engine: Readonly<import("@classicade/games").GameEngine<any, any, any>>,
 *   names: ReadonlyArray<string>,
 *   options: object,
 * }} input  `names` and `options` are read once, when the hook starts
 */
export function useLocalMatch({ engine, names, options }) {
  const match = useMemo(() => createLocalMatch({ engine, clock: PHONE_CLOCK, rng: PHONE_RNG }), [engine]);
  const [session, setSession] = useState(() => match.start({ names, options }));
  const room = useMemo(() => match.roomView(session), [match, session]);

  useEffect(() => {
    const due = match.deadline(session);
    if (due === 0) return undefined;
    // One millisecond late on purpose. A timer that fired a moment early would find nothing due and never run again.
    const timer = setTimeout(() => setSession(match.expire), Math.max(0, due - PHONE_CLOCK.now()) + 1);
    return () => clearTimeout(timer);
  }, [match, session]);

  /** A move from the board. A refusal rejects in the engine's words, as a refused move from the server does. */
  const move = useCallback(
    async (raw) => {
      const result = match.move(session, raw);
      if (!result.ok) throw new AppRequestError(result.error);
      setSession(result.session);
    },
    [match, session],
  );

  /** A move for a named player, such as resigning while the other side is to move. A refusal rejects, as above. */
  const moveAs = useCallback(
    async (playerId, raw) => {
      const result = match.moveAs(session, { playerId, move: raw });
      if (!result.ok) throw new AppRequestError(result.error);
      setSession(result.session);
    },
    [match, session],
  );
  const outcomeIf = useCallback(
    (playerId, raw) => match.outcomeIf(session, { playerId, move: raw }),
    [match, session],
  );

  const accept = useCallback((type) => setSession(match.accept(session, type)), [match, session]);
  const uncover = useCallback(() => setSession(match.uncover(session)), [match, session]);
  const playAgain = useCallback(() => setSession(match.playAgain(session)), [match, session]);

  return {
    room,
    holder: match.holder(session),
    covered: match.covered(session),
    move,
    moveAs,
    outcomeIf,
    accept,
    uncover,
    playAgain,
  };
}
