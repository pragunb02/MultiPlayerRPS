import { useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { useSealChecks } from "../../hooks/useSealChecks.js";
import { sealVerdict, shortLock } from "../../lib/sealCheck.js";
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
  unseen: "This browser did not see the lock before this round, so it cannot check it.",
});

/**
 * The computer's lock in Rock Paper Scissors (CC-225). Before you choose, it shows that the computer has locked in
 * a throw, as a short code, and this browser remembers it. After the round it says what the computer threw and
 * whether the remembered code matches the move, the key and the round's result, which this browser works out by
 * itself. "How we keep it fair" explains the check and shows it in full.
 *
 * @param {{ room: any, opponent: { playerId: string, displayName: string } }} props  `room` is a RoomView with
 *   `fairness`
 */
export function FairnessLock({ room, opponent }) {
  const [explaining, setExplaining] = useState(false);
  const locked = room.fairness.locked.find((entry) => entry.playerId === opponent.playerId);
  const seals = useSealChecks({ fairness: room.fairness, playerId: opponent.playerId });
  const last = seals.at(-1);
  // The computer seals one throw for each round, so its seals and the rounds go in step.
  const played = last && (room.game.view.rounds[seals.length - 1]?.choices[opponent.playerId] ?? "");
  const result = last && sealVerdict({ lockShown: last.lockShown, check: last, played, hashed: last.hashed });
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
          <span className={result === "mismatched" ? styles.bad : styles.good}>{RESULTS[result]}</span>
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
              {last.lockShown === "" ? RESULTS.unseen : <code className={styles.code}>{last.lockShown}</code>}
            </dd>
            <dt>Throw and key shown after the round</dt>
            <dd>
              <code className={styles.code}>
                {last.text}:{last.salt}
              </code>
            </dd>
            <dt>Lock sent with the throw and key</dt>
            <dd>
              <code className={styles.code}>{last.commitment}</code>
            </dd>
            <dt>Result</dt>
            <dd>{RESULTS[result]}</dd>
          </dl>
        )}
      </Modal>
    </div>
  );
}
