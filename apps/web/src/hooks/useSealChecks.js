import { useEffect, useState } from "react";
import { checkSeal } from "../lib/sealCheck.js";

/**
 * The computer player's shown seals in a game (CC-225), each with the lock this browser showed for it before the
 * round and how its hash checks out here. The lock is remembered the first time it is shown, by game, player and
 * turn, so a lock the server sends again later can never replace it. `hashed` is "checking" until the hash is
 * done, then "matched", "mismatched", or "unchecked" when the browser cannot hash. Each seal is hashed once.
 *
 * @param {{
 *   fairness: { game: string, locked: ReadonlyArray<{ playerId: string, turn: number, commitment: string }>, checks: ReadonlyArray<{ playerId: string, turn: number, text: string, salt: string, commitment: string }> },
 *   playerId: string,
 * }} input  the RoomView's `fairness`, and the computer player whose seals to follow
 * @param {typeof checkSeal} [check]  given only by tests
 * @returns {ReadonlyArray<{ playerId: string, turn: number, text: string, salt: string, commitment: string, lockShown: string, hashed: "checking" | "matched" | "mismatched" | "unchecked" }>}
 *   oldest first. `lockShown` is "" when this browser never saw the lock
 */
export function useSealChecks({ fairness, playerId }, check = checkSeal) {
  const [shown, setShown] = useState({});
  const [results, setResults] = useState({});
  const keyOf = (entry) => `${fairness.game}:${entry.playerId}:${entry.turn}`;
  const theirs = (entry) => entry.playerId === playerId;
  const checks = fairness.checks.filter(theirs);

  // Remembered while rendering, so a lock and its reveal in the next update can never slip past each other.
  const fresh = fairness.locked.filter((lock) => theirs(lock) && shown[keyOf(lock)] === undefined);
  if (fresh.length > 0) {
    setShown((before) => ({
      ...Object.fromEntries(fresh.map((lock) => [keyOf(lock), lock.commitment])),
      ...before,
    }));
  }

  // The list is a new object with every room update. Its text says whether there is anything new to check.
  const listed = JSON.stringify(checks.map(({ text, salt, commitment }) => ({ text, salt, commitment })));
  useEffect(() => {
    let live = true;
    const record = (commitment, result) => {
      if (live) setResults((before) => ({ ...before, [commitment]: result }));
    };
    for (const entry of JSON.parse(listed)) {
      check(entry).then(
        (matched) => record(entry.commitment, matched ? "matched" : "mismatched"),
        () => record(entry.commitment, "unchecked"),
      );
    }
    return () => {
      live = false;
    };
  }, [listed, check]);

  return checks.map((entry) => ({
    ...entry,
    lockShown: shown[keyOf(entry)] ?? "",
    hashed: results[entry.commitment] ?? "checking",
  }));
}
