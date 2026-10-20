import { Link, useLocation } from "react-router";
import { getGame } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { rankForLevel } from "../../art/badges/ranks.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { EmptyMatches } from "../../art/illustrations/EmptyMatches.jsx";
import { AchievementGrid } from "../../components/Achievements/AchievementGrid.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { YourRank } from "../../components/Leaderboard/YourRank.jsx";
import { useAction } from "../../hooks/useAction.js";
import { PageTitle } from "../../components/PageTitle.jsx";
import { DailyQuests } from "../../components/Quests/DailyQuests.jsx";
import { useStreakAtRisk } from "../../components/SaveProgress/saveProgressContext.js";
import { StreakAtRisk } from "../../components/SaveProgress/StreakAtRisk.jsx";
import { StreakCard } from "../../components/Streaks/StreakCard.jsx";
import { useMatchHistory } from "../../hooks/useMatchHistory.js";
import { useOwnProfile } from "../../hooks/useProfile.js";
import { useProgress } from "../../hooks/useProgress.js";
import { useSession } from "../../hooks/useSession.js";
import { AccountSettings } from "./AccountSettings.jsx";
import { BlockedPlayers } from "./BlockedPlayers.jsx";
import { PrivacySettings } from "./PrivacySettings.jsx";
import { PublicProfileSettings } from "./PublicProfileSettings.jsx";
import styles from "./ProfilePage.module.css";
import { VisitorProfile } from "./VisitorProfile.jsx";

const OUTCOME_LABEL = { win: "Won", loss: "Lost", draw: "Draw" };
const formatDate = (ms) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function ProgressCard() {
  const { status, progress, error } = useProgress();
  if (status === "loading") return <p>Loading progress…</p>;
  if (status === "error") return <p role="alert">Couldn't load progress. {error.message}</p>;
  return (
    <div className={styles.card}>
      <div className={styles.levelRow}>
        <LevelBadge level={progress.level} size="lg" decorative />
        <div>
          <p className={styles.level}>Level {progress.level}</p>
          <p className={styles.rank}>{rankForLevel(progress.level).name} rank</p>
        </div>
      </div>
      <progress
        className={styles.bar}
        aria-label="Progress to next level"
        max={Math.max(progress.xpForNextLevel, 1)}
        value={progress.xpForNextLevel === 0 ? 1 : progress.xpIntoLevel}
      />
      <p className={styles.muted}>
        {progress.xpIntoLevel} / {progress.xpForNextLevel} XP to level {progress.level + 1} · {progress.xp} XP
        total
      </p>
      <dl className={styles.stats}>
        <div>
          <dt>Played</dt>
          <dd>{progress.matchesPlayed}</dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd>{progress.wins}</dd>
        </div>
        <div>
          <dt>Lost</dt>
          <dd>{progress.losses}</dd>
        </div>
        <div>
          <dt>Drawn</dt>
          <dd>{progress.draws}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * A past opponent in history: their avatar and name, and a link to their profile when the server gave one, which it
 * does only for an adult account (CC-034). A computer character is labelled as one (ADR-025).
 */
function Opponent({ player, last }) {
  const name = player.computer ? `${player.displayName} (computer)` : player.displayName;
  return (
    <span className={styles.opponent}>
      {!player.computer && <Avatar avatar={player.avatar} size={20} />}
      {player.profile === undefined ? (
        name
      ) : (
        <Link to={paths.player(player.profile)} data-cc-control="profile.matches.opponent">
          {name}
        </Link>
      )}
      {!last && ", "}
    </span>
  );
}

function MatchHistory() {
  const history = useMatchHistory();
  const more = useAction(history.loadMore, { id: "profile.matches.more" });
  if (history.status === "loading") return <p>Loading matches…</p>;
  if (history.status === "error") return <p role="alert">Couldn't load matches. {history.error.message}</p>;
  if (history.matches.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyMatches />
        <p>
          No games yet.{" "}
          <Link to={paths.home()} data-cc-control="profile.play">
            Play one
          </Link>
        </p>
      </div>
    );
  }
  return (
    <>
      <ul className={styles.matches} aria-label="Match history">
        {history.matches.map((match) => {
          // A computer character is labelled as one, so it never reads as a person of the same name (ADR-025).
          // Players are named by ids made for this match, and `you` is yours (CC-297).
          const opponents = match.players.filter((p) => p.playerId !== match.you);
          return (
            <li key={match.matchId} className={styles.match}>
              <span className={`${styles.badge} ${styles[match.outcomeForYou]}`}>
                {OUTCOME_LABEL[match.outcomeForYou]}
              </span>
              <span className={styles.game}>
                <GameIcon gameId={match.gameId} />
                <span>
                  {getGame(match.gameId)?.name ?? match.gameId} vs{" "}
                  {opponents.length === 0
                    ? "—"
                    : opponents.map((player, index) => (
                        <Opponent
                          key={player.playerId}
                          player={player}
                          last={index === opponents.length - 1}
                        />
                      ))}
                </span>
              </span>
              <time className={styles.muted} dateTime={new Date(match.endedAt).toISOString()}>
                {formatDate(match.endedAt)}
              </time>
            </li>
          );
        })}
      </ul>
      {history.moreError && <p role="alert">Couldn't load more matches. {history.moreError.message}</p>}
      {history.hasMore && (
        <Button control="profile.matches.more" variant="secondary" action={more} pendingLabel="Loading…">
          Load more
        </Button>
      )}
    </>
  );
}

/**
 * Streaks, today's quests and achievements (CC-054, CC-089). Guests earn them too; signing up keeps them. A guest
 * whose streak is at risk gets that reminder instead of the general one (CC-097) — one sign-up line, not two.
 */
function PlayerConsole({ guest }) {
  const streakAtRisk = useStreakAtRisk();
  return (
    <section className={styles.console} aria-labelledby="player-console">
      <h2 id="player-console">Player console</h2>
      <StreakAtRisk />
      {guest && streakAtRisk === undefined && (
        <p className={styles.muted}>
          <Link to={paths.signup(paths.profile())} data-cc-control="profile.console.signup">
            Sign up to keep your streak and achievements
          </Link>
        </p>
      )}
      <StreakCard />
      <DailyQuests />
      <AchievementGrid />
    </section>
  );
}

/**
 * Your level, stats, match history and blocked players, for guests and account holders alike. Account holders also
 * get their account settings.
 */
export function ProfilePage() {
  const session = useSession();
  const own = useOwnProfile();
  // Set by the deletion on this page, so the visitor it leaves behind is told it worked (CC-035).
  const accountDeleted = useLocation().state?.accountDeleted === true;
  if (session.status === "loading") {
    return (
      <>
        <PageTitle>Your profile</PageTitle>
        <p>Loading…</p>
      </>
    );
  }
  if (session.identity === undefined) {
    return (
      <>
        {accountDeleted && (
          <p role="status" className={styles.notice}>
            Your account and its data are deleted. Copies in our encrypted backups are gone within 30 days.
          </p>
        )}
        <VisitorProfile />
      </>
    );
  }
  return (
    <section className={styles.page}>
      <PageTitle>{session.identity.displayName}</PageTitle>
      <div className={styles.nameRow}>
        <Avatar avatar={own.profile?.avatar} size={56} />
        <h1>{session.identity.displayName}</h1>
      </div>
      {session.identity.kind === "guest" && (
        <p className={styles.muted}>
          You're playing as a guest.{" "}
          <Link to={paths.signup(paths.profile())} data-cc-control="profile.signup">
            Create an account
          </Link>{" "}
          to keep your name.
        </p>
      )}
      <ProgressCard />
      <YourRank identity={session.identity} />
      <PlayerConsole guest={session.identity.kind === "guest"} />
      <h2>Recent matches</h2>
      <MatchHistory />
      <PublicProfileSettings own={own} guest={session.identity.kind === "guest"} />
      <BlockedPlayers />
      {session.identity.kind === "user" && <AccountSettings />}
      {session.identity.kind === "user" && <PrivacySettings />}
    </section>
  );
}
