import { useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { useSealChecks } from "../../hooks/useSealChecks.js";
import { sealVerdict } from "../../lib/sealCheck.js";
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

/**
 * What each verdict of `sealVerdict` means for the player, in everyday words. Only "matched" may say the round
 * was fair. The words changed in CC-254, the verdicts did not.
 */
const VERDICTS = Object.freeze({
  checking: (name) => `Checking that ${name}'s choice didn't change…`,
  matched: (name) => `✓ Fair: ${name}'s choice didn't change`,
  mismatched: (name) =>
    `Warning: ${name}'s choice doesn't match what was locked in. This round may not have been fair.`,
  unchecked: (name) =>
    `This browser can't check ${name}'s choice, so we can't show that this round was fair.`,
  unseen: (name) => `This page opened after ${name} chose, so it can't check this round.`,
});

/** The verdict line, with a warning sign in front of a mismatch. The sign is decoration, the words say it. */
function Verdict({ result, name }) {
  const bad = result === "mismatched";
  return (
    <span className={bad ? styles.bad : result === "matched" ? styles.good : styles.quiet}>
      {bad && <span aria-hidden="true">⚠ </span>}
      {VERDICTS[result](name)}
    </span>
  );
}

/**
 * The proof behind the plain words, for players who want to check it themselves. Before any round is over it
 * shows the lock for the round that is being played.
 */
function Proof({ last, locked, name }) {
  if (last === undefined) {
    return locked ? (
      <dl className={styles.proof}>
        <dt>Lock for this round</dt>
        <dd>
          <code className={styles.code}>{locked.commitment}</code>
        </dd>
        <dd className={styles.note}>{name}&apos;s choice and the secret key are shown after the round.</dd>
      </dl>
    ) : (
      <p className={styles.note}>The proof shows here once {name} has chosen.</p>
    );
  }
  return (
    <>
      <dl className={styles.proof}>
        <dt>Lock shown before you picked</dt>
        <dd>
          {last.lockShown === "" ? (
            VERDICTS.unseen(name)
          ) : (
            <code className={styles.code}>{last.lockShown}</code>
          )}
        </dd>
        <dt>{name}&apos;s choice, shown after the round</dt>
        <dd>{throwOf(last)}</dd>
        <dt>Secret key, shown after the round</dt>
        <dd>
          <code className={styles.code}>{last.salt}</code>
        </dd>
        <dt>Text to check (the choice, a colon and the key)</dt>
        <dd>
          <code className={styles.code}>
            {last.text}:{last.salt}
          </code>
        </dd>
        <dt>Lock sent with the choice and the key</dt>
        <dd>
          <code className={styles.code}>{last.commitment}</code>
        </dd>
      </dl>
      <p className={styles.note}>
        Anyone can check it with any SHA-256 tool: put in the text to check, and the answer must be the lock
        shown before you picked.
      </p>
    </>
  );
}

/**
 * The computer's lock in Rock Paper Scissors (CC-225), in plain words (CC-254). Before you pick it says that the
 * computer has chosen and cannot change it, and this browser remembers the lock. After the round it says whether
 * the choice stayed the same: the remembered lock, the choice, the key and the round's result must all agree, and
 * this browser works that out by itself. The main screen shows no codes. "How we keep it fair" explains the idea
 * in three steps, and the codes are there, folded away, for anyone who wants to check them.
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
          <span aria-hidden="true">🔒</span> {name} has chosen. It&apos;s locked, so {name} can&apos;t change
          it after you pick.
        </p>
      )}
      {last && (
        <p className={styles.line} role="status">
          <Verdict result={result} name={name} />
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
        <ol className={styles.steps}>
          <li>
            {name} is a computer player and picks first, in secret. It&apos;s like writing the choice on a
            card and sealing it in an envelope.
          </li>
          <li>
            You see that the envelope is sealed before you pick. Once it&apos;s sealed, nobody can change what
            is inside: not {name}, and not us.
          </li>
          <li>
            After you pick, the envelope is opened. Your own browser checks that the choice inside is the one
            that was sealed, and the one {name} played.
          </li>
        </ol>
        {last && (
          <p className={styles.line}>
            <Verdict result={result} name={name} />
          </p>
        )}
        <details className={styles.details}>
          <summary className={styles.summary}>Show the proof (for the curious)</summary>
          <Proof last={last} locked={locked} name={name} />
        </details>
      </Modal>
    </div>
  );
}
