import { useId } from "react";
import { StreakFlame } from "../../art/effects/StreakFlame.jsx";
import { useStreaks } from "../../hooks/useStreaks.js";
import { Button } from "../Button/Button.jsx";
import { clockTime } from "../Quests/clockTime.js";
import styles from "./StreakCard.module.css";

const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;
const wins = (n) => `${n} ${n === 1 ? "win" : "wins"}`;
const matches = (n) => `${n === 1 ? "One more match" : `${n} matches`}`;

/**
 * What the daily streak needs from you today, as plain facts (CC-145 D5: no countdown, no loss words). With
 * freezes, a missed day a freeze covers is said as it is.
 */
function DailyHint({ daily }) {
  const { freezes } = daily;
  if (freezes !== undefined && freezes.covering > 0) {
    const missed = freezes.covering === 1 ? "yesterday" : `the last ${freezes.covering} days`;
    return (
      <p className={styles.muted}>
        A freeze covered {missed}, so your {daily.current}-day streak carries on when you play today.{" "}
        {matches(freezes.earnBackLeft)} today earn it back.
      </p>
    );
  }
  if (daily.atRisk) {
    return <p className={styles.atRisk}>Play today to keep your {daily.current}-day streak</p>;
  }
  if (daily.playedToday) {
    const earnBack =
      freezes !== undefined && freezes.earnBackLeft > 0
        ? ` ${matches(freezes.earnBackLeft)} today ${freezes.earnBackLeft === 1 ? "earns" : "earn"} your freeze back.`
        : "";
    return (
      <p className={styles.muted}>You've played today. Come back tomorrow to keep it going.{earnBack}</p>
    );
  }
  if (freezes !== undefined && daily.current > 0) {
    return <p className={styles.muted}>Play today to add a day. A freeze covers today if you don't.</p>;
  }
  return <p className={styles.muted}>No streak yet. Play a match today to start one.</p>;
}

/**
 * The freezes beside the streak (CC-145): a snowflake and "1 of 2", in the info tokens. Minimal on purpose: the
 * gaming-layer redesign restyles it (CC-330).
 */
function FreezeIndicator({ freezes }) {
  return (
    <p className={styles.freezes}>
      <span aria-hidden="true">❄ </span>
      {freezes.held} of {freezes.max} freezes
      <span className="visually-hidden">
        . A freeze covers a day you miss, by itself. You earn one each week you play.
      </span>
    </p>
  );
}

/** Your daily play streak and win streak, with the best of each (CC-054), and freezes when they are on (CC-145). */
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
        <Button control="streaks.retry" variant="secondary" onClick={streaks.retry}>
          Try again
        </Button>
      </div>
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
          <div className={styles.lines}>
            {daily.freezes !== undefined && <FreezeIndicator freezes={daily.freezes} />}
            <DailyHint daily={daily} />
            {daily.nextMilestone !== undefined && daily.nextMilestone !== null && (
              <p className={styles.muted}>Next milestone: {days(daily.nextMilestone)}</p>
            )}
            {daily.resetsAt !== undefined && (
              <p className={styles.muted}>Your day ends at {clockTime(daily.resetsAt)}.</p>
            )}
          </div>
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
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Streaks
      </h3>
      {body}
    </section>
  );
}
