import { useState } from "react";
import { BOT_DAILY_XP } from "@classicade/shared";
import { Button } from "../Button/Button.jsx";
import { Card, CardBody, CardHeader } from "../Card/Card.jsx";
import styles from "./PlayComputer.module.css";

/**
 * The lobby's main action (CC-221): play the game's computer character at once. One tap on a level picks it, and
 * the big button starts the game with the character already seated. The character is named as a computer player
 * before the game starts (ADR-025), and the note says how its games count.
 *
 * It is the lobby's featured card, the raised one, and its Play button is the lobby's one primary. The levels are
 * secondary buttons, the picked one pressed (CC-323).
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
    <Card as="section" variant="raised" aria-labelledby="play-computer-heading">
      <CardHeader
        id="play-computer-heading"
        title={`Play ${character.name}`}
        titleAs="h2"
        description={
          <>
            <span className={styles.badge}>Computer</span> {character.name}: {character.tagline}
          </>
        }
      />
      <CardBody>
        <div className={styles.levels} role="group" aria-label="Level">
          {character.levels.map((entry) => (
            <Button
              key={entry.id}
              control="lobby.computer_level"
              variant="secondary"
              className={entry.id === pick.level ? styles.picked : ""}
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
      </CardBody>
    </Card>
  );
}
