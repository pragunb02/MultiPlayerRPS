import { useState } from "react";
import { BOT_DAILY_XP, QUICK_MATCH_RULES } from "@classicade/shared";
import { Button } from "../Button/Button.jsx";
import styles from "./PlayComputer.module.css";

/**
 * The lobby's main action (CC-221): play the game's computer character at once. One tap on a level picks it, and
 * the big button starts the game with the character already seated. The character is named as a computer player
 * before the game starts (ADR-025), and the note says how its games count.
 *
 * With quick match (CC-051, `quickMatch`), the same button first looks for a person for a few seconds, and the
 * panel says so before the press: nobody is surprised by a person, and the computer is named on the button. While
 * it looks, the panel says what happens if nobody is free and offers Cancel.
 *
 * Every press of a level answers (CC-164): the line under the levels says how the character plays at it, and comes
 * in again when the level that is already picked is pressed.
 *
 * @param {{
 *   character: { name: string, tagline: string, levels: ReadonlyArray<{ id: string, name: string, description: string }> },
 *   action: ReturnType<typeof import("../../hooks/useAction.js").useAction>,
 *   quickMatch?: { onCancel: () => void },
 * }} props  `action` runs with the picked level id. `quickMatch` is given when the button looks for a person first
 */
export function PlayComputer({ character, action, quickMatch }) {
  const [pick, setPick] = useState({ level: character.levels[0].id, presses: 0 });
  const picked = character.levels.find((entry) => entry.id === pick.level);
  const seconds = QUICK_MATCH_RULES.searchMs / 1000;
  const looking = quickMatch !== undefined && action.waitingShown;
  return (
    <section className={styles.panel} aria-labelledby="play-computer-heading" aria-busy={looking}>
      <h2 id="play-computer-heading">Play {character.name}</h2>
      <p className={styles.who}>
        <span className={styles.badge}>Computer</span> {character.name}: {character.tagline}
      </p>
      <div className={styles.levels} role="group" aria-label="Level">
        {character.levels.map((entry) => (
          <Button
            key={entry.id}
            control="lobby.computer_level"
            variant={entry.id === pick.level ? "primary" : "secondary"}
            aria-pressed={entry.id === pick.level}
            onClick={() => setPick(({ presses }) => ({ level: entry.id, presses: presses + 1 }))}
          >
            {entry.name}
          </Button>
        ))}
      </div>
      <p key={pick.presses} className={styles.level} aria-live="polite">
        <strong>{picked.name}:</strong> {picked.description}
      </p>
      {quickMatch !== undefined && (
        <p className={styles.quick}>
          First we look for a person to play, for up to {seconds} seconds. If nobody is free, you play{" "}
          {character.name}.
        </p>
      )}
      <Button
        control="lobby.play_computer"
        size="lg"
        action={action}
        onClick={() => action.run(pick.level)}
        pendingLabel={quickMatch === undefined ? "Starting…" : "Looking for a person…"}
      >
        Play {character.name}
      </Button>
      <div className={styles.searching} role="status">
        {looking && (
          <>
            <span>Still looking. If nobody is free, you play {character.name}, a computer player.</span>
            <Button control="lobby.quick_match_cancel" variant="secondary" onClick={quickMatch.onCancel}>
              Cancel
            </Button>
          </>
        )}
      </div>
      <p className={styles.note}>
        Games against the computer count for quests and up to {BOT_DAILY_XP} XP a day. They never count on
        leaderboards.
      </p>
    </section>
  );
}
