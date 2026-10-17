import { useEffect, useState } from "react";
import { checkSeal } from "../lib/sealCheck.js";

/**
 * How each shown seal checks out in this browser (CC-225): "checking" until the hash is done, then "matched",
 * "mismatched", or "unchecked" when the browser cannot hash. Keyed by the lock, so a seal is checked once.
 *
 * @param {ReadonlyArray<{ text: string, salt: string, commitment: string }>} checks  the RoomView's `fairness.checks`
 * @param {typeof checkSeal} [check]  given only by tests
 * @returns {Readonly<Record<string, "checking" | "matched" | "mismatched" | "unchecked">>}
 */
export function useSealChecks(checks, check = checkSeal) {
  const [results, setResults] = useState({});
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

  return Object.fromEntries(
    checks.map((entry) => [entry.commitment, results[entry.commitment] ?? "checking"]),
  );
}
