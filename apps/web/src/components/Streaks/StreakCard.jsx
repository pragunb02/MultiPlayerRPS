import { useId } from "react";
import { StreakFlame } from "../../art/effects/StreakFlame.jsx";
import { useStreaks } from "../../hooks/useStreaks.js";
import { Card, CardHeader } from "../Card/Card.jsx";
import { ErrorState, Skeleton } from "../States/States.jsx";
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
    body = <Skeleton label="Loading streaks" shape="tile" count={2} />;
  } else if (streaks.status === "error") {
    body = (
      <ErrorState
        title={`Couldn't load streaks. ${streaks.error.message}`}
        control="streaks"
        onRetry={streaks.retry}
      />
    );
  } else {
    const { daily, win } = streaks.data;
    body = (
      <>
        <div className={styles.top}>
          {/* The flame is the picture of the daily streak; the list below says the same in words. */}
          <span className={styles.flameWrap} aria-hidden="true">
            <StreakFlame count={daily.current} className={styles.flame} />
          </span>
          <DailyHint daily={daily} />
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Daily streak</dt>
            <dd>{days(daily.current)}</dd>
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
    <Card as="section" aria-labelledby={headingId}>
      <CardHeader id={headingId} title="Streaks" description="Days in a row you played, and wins in a row." />
      {body}
    </Card>
  );
}
