import { useId } from "react";
import { useStreaks } from "../../hooks/useStreaks.js";
import { Button } from "../Button/Button.jsx";
import styles from "./StreakCard.module.css";

const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;
const wins = (n) => `${n} ${n === 1 ? "win" : "wins"}`;

/** What the daily streak needs from you today. */
function DailyHint({ daily }) {
  if (daily.atRisk) {
    return <p className={styles.atRisk}>Play today to keep your {daily.current}-day streak</p>;
  }
  if (daily.playedToday) {
    return <p className={styles.muted}>You've played today. Come back tomorrow to keep it going.</p>;
  }
  return <p className={styles.muted}>No streak yet. Play a match today to start one.</p>;
}

/** Your daily play streak and win streak, with the best of each (CC-054). */
export function StreakCard() {
  const streaks = useStreaks();
  const headingId = useId();

  let body;
  if (streaks.status === "loading") {
    body = <p>Loading streaks…</p>;
  } else if (streaks.status === "error") {
    body = (
      <div role="alert" className={styles.problem}>
        <p>Couldn't load streaks. {streaks.error.message}</p>
        <Button variant="secondary" onClick={streaks.retry}>
          Try again
        </Button>
      </div>
    );
  } else {
    const { daily, win } = streaks.data;
    body = (
      <>
        <DailyHint daily={daily} />
        <dl className={styles.stats}>
          <div>
            <dt>Daily streak</dt>
            <dd>
              <span className={styles.flame} aria-hidden="true">
                ▲{" "}
              </span>
              {days(daily.current)}
            </dd>
          </div>
          <div>
            <dt>Best daily streak</dt>
            <dd>{days(daily.best)}</dd>
          </div>
          <div>
            <dt>Win streak</dt>
            <dd>{wins(win.current)}</dd>
          </div>
          <div>
            <dt>Best win streak</dt>
            <dd>{wins(win.best)}</dd>
          </div>
        </dl>
      </>
    );
  }

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Streaks
      </h3>
      {body}
    </section>
  );
}
