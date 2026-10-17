import { useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { useSealChecks } from "../../hooks/useSealChecks.js";
import { shortLock } from "../../lib/sealCheck.js";
import styles from "./FairnessLock.module.css";

const THROWS = Object.freeze({ rock: "Rock", paper: "Paper", scissors: "Scissors" });

/** The throw a check reveals, in words. Text that is not a throw this app knows is shown as it is. */
function throwOf(check) {
  try {
    return THROWS[JSON.parse(check.text).choice] ?? check.text;
  } catch {
    return check.text;
  }
}

const RESULTS = Object.freeze({
  checking: "Checking the lock…",
  matched: "Lock checked ✓",
  mismatched: "The lock does not match this throw.",
  unchecked: "This browser could not check the lock.",
});

/**
 * The computer's lock in Rock Paper Scissors (CC-225). Before you choose, it shows that the computer has locked in
 * a throw, as a short code. After the round it says what the computer threw and whether the code matches, which
 * this browser works out by itself. "How we keep it fair" explains the check and shows it in full.
 *
 * @param {{ room: any, opponent: { playerId: string, displayName: string } }} props  `room` is a RoomView with
 *   `fairness`
 */
export function FairnessLock({ room, opponent }) {
  const [explaining, setExplaining] = useState(false);
  const theirs = (entry) => entry.playerId === opponent.playerId;
  const locked = room.fairness.locked.find(theirs);
  const checks = room.fairness.checks.filter(theirs);
  const results = useSealChecks(checks);
  const last = checks.at(-1);
  const name = opponent.displayName;

  return (
    <div className={styles.lock}>
      {locked && (
        <p className={styles.line}>
          <span aria-hidden="true">🔒</span> {name} has locked in a throw. Lock{" "}
          <code className={styles.code}>{shortLock(locked.commitment)}</code>
        </p>
      )}
      {last && (
        <p className={styles.line} role="status">
          {name} threw {throwOf(last)}.{" "}
          <span className={results[last.commitment] === "mismatched" ? styles.bad : styles.good}>
            {RESULTS[results[last.commitment]]}
          </span>
        </p>
      )}
      <Button control="rps.fairness" variant="ghost" onClick={() => setExplaining(true)}>
        How we keep it fair
      </Button>
      <Modal
        open={explaining}
        title="How we keep it fair"
        onClose={() => setExplaining(false)}
        actions={
          <Button control="rps.fairness.close" onClick={() => setExplaining(false)}>
            Got it
          </Button>
        }
      >
        <p>
          {name} is a computer player and chooses before you do. Before you choose, you see a lock: a code
          made from {name}&apos;s throw and a secret key. After the round we show the throw and the key, and
          your browser makes the code again from them. When it matches the lock, {name} could not have changed
          the throw after seeing yours.
        </p>
        {last && (
          <dl className={styles.proof}>
            <dt>Lock shown before you chose</dt>
            <dd>
              <code className={styles.code}>{last.commitment}</code>
            </dd>
            <dt>Throw and key shown after the round</dt>
            <dd>
              <code className={styles.code}>
                {last.text}:{last.salt}
              </code>
            </dd>
            <dt>SHA-256 of the throw and key</dt>
            <dd>{RESULTS[results[last.commitment]]}</dd>
          </dl>
        )}
      </Modal>
    </div>
  );
}
