import { useId } from "react";
import { AchievementIcon } from "../../art/achievements/AchievementIcon.jsx";
import { useAchievements } from "../../hooks/useAchievements.js";
import { Card, CardHeader } from "../Card/Card.jsx";
import { ErrorState, Skeleton } from "../States/States.jsx";
import styles from "./AchievementGrid.module.css";

const TIER_LABEL = Object.freeze({ bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" });
const TIER_CLASS = Object.freeze({
  bronze: styles.bronze,
  silver: styles.silver,
  gold: styles.gold,
  platinum: styles.platinum,
});
const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

/**
 * The achievement's medal (CC-087 art): its icon on a disc in the tier colour, or a grey padlocked silhouette while
 * locked. Decoration — the name, tier and "Locked." are text. An unknown tier is drawn bronze, an unknown icon a star.
 */
function Badge({ achievement, locked }) {
  const tier = achievement.tier in TIER_LABEL ? achievement.tier : "bronze";
  return (
    <span className={styles.badge} data-icon={achievement.icon} aria-hidden="true">
      <AchievementIcon name={achievement.icon} tier={tier} locked={locked} className={styles.icon} />
    </span>
  );
}

function AchievementItem({ achievement }) {
  const locked = achievement.unlockedAt === null;
  const { current, target } = achievement.progress;
  return (
    <li className={`${styles.item} ${TIER_CLASS[achievement.tier] ?? ""} ${locked ? styles.locked : ""}`}>
      <Badge achievement={achievement} locked={locked} />
      <span className={styles.text}>
        <span className={styles.name}>{achievement.name}</span>
        <span className={styles.muted}>{achievement.description}</span>
        <span className={styles.tier}>{TIER_LABEL[achievement.tier] ?? achievement.tier}</span>
      </span>
      {locked ? (
        <span className={styles.meter}>
          <span className="visually-hidden">Locked. </span>
          <progress
            className={styles.bar}
            max={target}
            value={current}
            aria-label={`${achievement.name} progress`}
          />
          <span className={styles.count}>
            {current}/{target}
          </span>
        </span>
      ) : (
        <span className={styles.unlockedAt}>
          Unlocked{" "}
          <time dateTime={new Date(achievement.unlockedAt).toISOString()}>
            {formatDate(achievement.unlockedAt)}
          </time>
        </span>
      )}
    </li>
  );
}

/** Every achievement: unlocked ones with their date, locked ones greyed with progress (CC-054). */
export function AchievementGrid() {
  const achievements = useAchievements();
  const headingId = useId();

  let body;
  if (achievements.status === "loading") {
    body = <Skeleton label="Loading achievements" shape="row" count={4} />;
  } else if (achievements.status === "error") {
    body = (
      <ErrorState
        title={`Couldn't load achievements. ${achievements.error.message}`}
        control="achievements"
        onRetry={achievements.retry}
      />
    );
  } else {
    const list = achievements.data;
    const unlocked = list.filter((a) => a.unlockedAt !== null).length;
    body = (
      <>
        <p className={styles.summary}>
          {unlocked}/{list.length} unlocked
        </p>
        {unlocked === 0 && (
          <p className={styles.muted}>Play your first match to unlock your first achievement.</p>
        )}
        <ul className={styles.grid} aria-label="Achievements">
          {list.map((achievement) => (
            <AchievementItem key={achievement.id} achievement={achievement} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <Card as="section" aria-labelledby={headingId}>
      <CardHeader
        id={headingId}
        title="Achievements"
        description="Every medal in the arcade: unlocked ones with their day, locked ones with how far you are."
      />
      {body}
    </Card>
  );
}
