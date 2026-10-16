import { useId } from "react";
import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { AchievementIcon } from "../../art/achievements/AchievementIcon.jsx";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { useCountdown } from "../../hooks/useCountdown.js";
import { useQuests } from "../../hooks/useQuests.js";
import { Button } from "../Button/Button.jsx";
import styles from "./DailyQuests.module.css";
import { resetsIn } from "./resetsIn.js";

const isDone = (item) => item.completedAt !== null;

/** "Resets in 5h 12m"; reloads the quests when the day is over. Not announced: it changes every minute. */
function ResetsIn({ at, onElapsed }) {
  const remaining = useCountdown({ target: at, onElapsed });
  return (
    <p className={styles.muted} aria-live="off">
      {resetsIn(remaining)}
    </p>
  );
}

/** A quest's picture: the game's glyph for a game quest, a scroll (gold once done) for the others. Decoration. */
function QuestIcon({ item }) {
  return (
    <span className={styles.icon} aria-hidden="true">
      {item.gameId ? (
        <GameIcon gameId={item.gameId} size={32} />
      ) : (
        <AchievementIcon name="scroll" tier={isDone(item) ? "gold" : "silver"} className={styles.scroll} />
      )}
    </span>
  );
}

function QuestItem({ item }) {
  const done = isDone(item);
  return (
    <li className={`${styles.quest} ${done ? styles.done : ""}`}>
      <QuestIcon item={item} />
      <span className={styles.text}>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.muted}>{item.description}</span>
      </span>
      {done ? (
        <span className={styles.reward}>
          <span aria-hidden="true">✓ </span>Completed · +{item.bonusXp} XP
        </span>
      ) : (
        <span className={styles.meter}>
          <progress
            className={styles.bar}
            max={item.target}
            value={item.progress}
            aria-label={`${item.name} progress`}
          />
          <span className={styles.count}>
            {item.progress}/{item.target}
          </span>
          <span className={styles.muted}>+{item.bonusXp} XP</span>
        </span>
      )}
    </li>
  );
}

function SweepRow({ sweep }) {
  return (
    <p className={`${styles.sweep} ${sweep.completedAt === null ? "" : styles.done}`}>
      {sweep.completedAt === null
        ? `Daily sweep: finish all three for +${sweep.bonusXp} XP`
        : `Daily sweep complete! +${sweep.bonusXp} XP`}
    </p>
  );
}

/**
 * Today's three quests (CC-089): progress, rewards, the sweep bonus and when they reset. `compact` is the one-card
 * summary for the home page, linking to the full list on the profile.
 *
 * @param {{ compact?: boolean }} props
 */
export function DailyQuests({ compact = false }) {
  const quests = useQuests();
  const headingId = useId();
  const Heading = compact ? "h2" : "h3";

  let body;
  if (quests.status === "loading") {
    body = <p>Loading quests…</p>;
  } else if (quests.status === "error") {
    body = (
      <div role="alert" className={styles.problem}>
        <p>Couldn't load quests. {quests.error.message}</p>
        <Button variant="secondary" onClick={quests.retry}>
          Try again
        </Button>
      </div>
    );
  } else {
    const { items, sweep, resetsAt } = quests.data;
    const done = items.filter(isDone).length;
    const started = items.some((item) => item.progress > 0);
    body = (
      <>
        <p className={styles.summary}>
          {done}/{items.length} done
        </p>
        {!started && <p className={styles.muted}>Play your first match to start quests.</p>}
        {compact ? (
          <ul className={styles.chips} aria-label="Today's quests">
            {items.map((item) => (
              <li key={item.id} className={`${styles.chip} ${isDone(item) ? styles.done : ""}`}>
                {item.name}{" "}
                <span className={styles.count}>{isDone(item) ? "✓" : `${item.progress}/${item.target}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <ul className={styles.list} aria-label="Today's quests">
              {items.map((item) => (
                <QuestItem key={item.id} item={item} />
              ))}
            </ul>
            <SweepRow sweep={sweep} />
          </>
        )}
        <ResetsIn at={resetsAt} onElapsed={quests.retry} />
        {compact && <Link to={paths.profile()}>Open your player console</Link>}
      </>
    );
  }

  return (
    <section className={`${styles.card} ${compact ? styles.compact : ""}`} aria-labelledby={headingId}>
      <Heading id={headingId} className={styles.heading}>
        Daily quests
      </Heading>
      {body}
    </section>
  );
}
