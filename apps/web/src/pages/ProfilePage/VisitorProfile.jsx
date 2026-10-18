import { Link } from "react-router";
import { ACHIEVEMENTS } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { AchievementIcon } from "../../art/achievements/AchievementIcon.jsx";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { rankForLevel } from "../../art/badges/ranks.js";
import { StreakFlame } from "../../art/effects/StreakFlame.jsx";
import { EmptyMatches } from "../../art/illustrations/EmptyMatches.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./VisitorProfile.module.css";

// The first achievements of the real catalog, so the preview shows medals a new player can actually earn.
const FIRST_ACHIEVEMENTS = ACHIEVEMENTS.slice(0, 3);
const FIRST_LEVEL = 1;

/**
 * The card a player gets, drawn greyed out and empty: a level badge, an unlit streak flame and locked medals. The
 * pictures are decoration. Each item's words say what it is, and nothing here pretends to be progress.
 */
function PreviewCard() {
  return (
    <div className={styles.card}>
      <div className={styles.levelRow}>
        <span className={styles.ghost} aria-hidden="true">
          <LevelBadge level={FIRST_LEVEL} size="lg" decorative />
        </span>
        <div>
          <p className={styles.level}>Level {FIRST_LEVEL}</p>
          <p className={styles.muted}>{rankForLevel(FIRST_LEVEL).name} rank, 0 XP so far</p>
        </div>
      </div>
      <span className={styles.bar} aria-hidden="true" />
      <ul className={styles.items} aria-label="What your card will show">
        <li className={styles.item}>
          <span className={styles.ghost} aria-hidden="true">
            <StreakFlame count={0} className={styles.flame} />
          </span>
          <span>Daily streak</span>
        </li>
        {FIRST_ACHIEVEMENTS.map((achievement) => (
          <li key={achievement.id} className={styles.item}>
            <span className={styles.ghost} aria-hidden="true">
              <AchievementIcon name={achievement.icon} locked className={styles.medal} />
            </span>
            <span>{achievement.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The profile for someone without a session (CC-259). Instead of one line on an empty page, it shows what the
 * card will hold once they play, and the two ways in: play as a guest at once, or log in to an account.
 */
export function VisitorProfile() {
  const session = useSession();
  // As on the home page, the guest starts here and this page becomes their own profile.
  const start = useAction(session.ensurePlayer, { id: "profile.play_guest" });
  return (
    <section className={styles.page} aria-labelledby="visitor-profile">
      <PageTitle>Your profile</PageTitle>
      <div className={styles.text}>
        <EmptyMatches className={styles.art} />
        <h1 id="visitor-profile">Your profile</h1>
        <p className={styles.lead}>Your arcade card starts with your first game.</p>
        <p className={styles.muted}>No sign-up needed. A guest earns XP, streaks and medals too.</p>
        <div className={styles.actions}>
          <Button control="profile.play_guest" variant="accent" size="lg" action={start}>
            Play as a guest
          </Button>
          <Link to={paths.login(paths.profile())} className={styles.login} data-cc-control="profile.login">
            Log in
          </Link>
        </div>
      </div>
      <PreviewCard />
    </section>
  );
}
