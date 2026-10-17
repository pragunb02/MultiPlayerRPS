import { useState } from "react";
import { BOT_DAILY_XP } from "@classicade/shared";
import { Button } from "../Button/Button.jsx";
import styles from "./PlayComputer.module.css";

/**
 * The lobby's main action (CC-221): play the game's computer character at once. One tap on a level picks it, and
 * the big button starts the game with the character already seated. The character is named as a computer player
 * before the game starts (ADR-025), and the note says how its games count.
 *
 * Every press of a level answers (CC-164): the line under the levels says how the character plays at it, and comes
 * in again when the level that is already picked is pressed.
 *
 * @param {{
 *   character: { name: string, tagline: string, levels: ReadonlyArray<{ id: string, name: string, description: string }> },
 *   action: ReturnType<typeof import("../../hooks/useAction.js").useAction>,
 * }} props  `action` runs with the picked level id
 */
export function PlayComputer({ character, action }) {
  const [pick, setPick] = useState({ level: character.levels[0].id, presses: 0 });
  const picked = character.levels.find((entry) => entry.id === pick.level);
  return (
    <section className={styles.panel} aria-labelledby="play-computer-heading">
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
      <Button
        control="lobby.play_computer"
        size="lg"
        action={action}
        onClick={() => action.run(pick.level)}
        pendingLabel="Starting…"
      >
        Play {character.name}
      </Button>
      <p className={styles.note}>
        Games against the computer count for quests and up to {BOT_DAILY_XP} XP a day. They never count on
        leaderboards.
      </p>
    </section>
  );
}
