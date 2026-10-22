import { useState } from "react";
import { Link, useLocation } from "react-router";
import { DELETED_PLAYER_NAME, getGame } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { rankForLevel } from "../../art/badges/ranks.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { EmptyMatches } from "../../art/illustrations/EmptyMatches.jsx";
import { AchievementGrid } from "../../components/Achievements/AchievementGrid.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { Card } from "../../components/Card/Card.jsx";
import { AddFriendButton } from "../../components/Friends/AddFriendButton.jsx";
import { YourRank } from "../../components/Leaderboard/YourRank.jsx";
import { useAction } from "../../hooks/useAction.js";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Section, Sections } from "../../components/Page/Page.jsx";
import { ReportDialog } from "../../components/Report/ReportDialog.jsx";
import { DailyQuests } from "../../components/Quests/DailyQuests.jsx";
import { useStreakAtRisk } from "../../components/SaveProgress/saveProgressContext.js";
import { StreakAtRisk } from "../../components/SaveProgress/StreakAtRisk.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
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

/** Your level, the XP to the next one and your games, all time. Each number has its word and its unit. */
function ProgressCard() {
  const { status, progress, error } = useProgress();
  if (status === "loading") return <Skeleton label="Loading progress" shape="card" />;
  if (status === "error")
    return <ErrorState title={`Couldn't load progress. ${error.message}`} control="profile.progress" />;
  return (
    <Card variant="raised" aria-labelledby="profile-level">
      <div className={styles.levelRow}>
        <LevelBadge level={progress.level} size="lg" decorative />
        <div>
          <p className={styles.level} id="profile-level">
            Level {progress.level}
          </p>
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
      <dl className={styles.stats} aria-label="Games, all time">
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
    </Card>
  );
}

/**
 * A past opponent in history: their avatar and name, and a link to their profile when the server gave one, which it
 * does only for an adult account (CC-034). A computer character is labelled as one (ADR-025). An account can add a
 * person as a friend, named by the match and their place in it, never by id (CC-052). A guest is not offered it
 * here: the Friends page and the room tell them how to save their progress.
 */
function Opponent({ player, last, target, canAddFriends }) {
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
      {canAddFriends && !player.computer && player.displayName !== DELETED_PLAYER_NAME && (
        <AddFriendButton target={target} name={player.displayName} control="profile.matches.friend" />
      )}
      {!last && ", "}
    </span>
  );
}

/** Whether a past opponent is a person who can be reported: not a computer, not a deleted player's stand-in. */
const isReportable = (player) => !player.computer && player.displayName !== DELETED_PLAYER_NAME;

function MatchHistory({ canAddFriends }) {
  const history = useMatchHistory();
  // The opponent the player pressed Report on, by the match and their place in it (CC-044, ADR-071).
  const [reporting, setReporting] = useState(undefined);
  const more = useAction(history.loadMore, { id: "profile.matches.more" });
  if (history.status === "loading") return <Skeleton label="Loading matches" shape="row" count={3} />;
  if (history.status === "error") {
    return <ErrorState title={`Couldn't load matches. ${history.error.message}`} control="profile.matches" />;
  }
  if (history.matches.length === 0) {
    return (
      <EmptyState
        title="No games yet."
        headingLevel={3}
        art={<EmptyMatches />}
        action={
          <Button as="link" to={paths.home()} control="profile.play">
            Play one
          </Button>
        }
      >
        Every game you finish shows here, newest first.
      </EmptyState>
    );
  }
  return (
    <>
      <Card as="div">
        {/* The column names, for the eye. Each row says the same in words. */}
        <p className={styles.matchHead} aria-hidden="true">
          <span>Result</span>
          <span>Game and opponent</span>
          <span>When</span>
        </p>
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
                            target={{ matchId: match.matchId, seat: match.players.indexOf(player) }}
                            canAddFriends={canAddFriends}
                          />
                        ))}
                  </span>
                </span>
                <time className={styles.muted} dateTime={new Date(match.endedAt).toISOString()}>
                  {formatDate(match.endedAt)}
                </time>
                {match.players.map(
                  (player, seat) =>
                    player.playerId !== match.you &&
                    isReportable(player) && (
                      <Button
                        key={player.playerId}
                        control="profile.matches.report"
                        variant="ghost"
                        size="sm"
                        className={styles.report}
                        aria-label={`Report ${player.displayName}`}
                        onClick={() =>
                          setReporting({ name: player.displayName, target: { matchId: match.matchId, seat } })
                        }
                      >
                        Report
                      </Button>
                    ),
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {reporting !== undefined && (
        <ReportDialog
          name={reporting.name}
          target={reporting.target}
          canBlock
          onBlocked={() => undefined}
          onClose={() => setReporting(undefined)}
        />
      )}
      {history.moreError && (
        <ErrorState
          title={`Couldn't load more matches. ${history.moreError.message}`}
          control="profile.matches.more"
        />
      )}
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
    <Section
      id="player-console"
      title="Player console"
      description="Your streaks, today's quests and every achievement."
    >
      <StreakAtRisk />
      {guest && streakAtRisk === undefined && (
        <p className={styles.muted}>
          <Link to={paths.signup(paths.profile())} data-cc-control="profile.console.signup">
            Sign up to keep your streak and achievements
          </Link>
        </p>
      )}
      <div className={styles.consoleGrid}>
        <StreakCard />
        <DailyQuests />
      </div>
      <AchievementGrid />
    </Section>
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
        <Skeleton label="Loading your profile" shape="card" />
      </>
    );
  }
  if (session.identity === undefined) {
    return (
      <div className={styles.visitor}>
        {accountDeleted && (
          <Card variant="notice" tone="success" as="div">
            <p role="status" className={styles.noticeLine}>
              Your account and its data are deleted. Copies in our encrypted backups are gone within 30 days.
            </p>
          </Card>
        )}
        <VisitorProfile />
      </div>
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
      <p className={styles.muted}>
        <Link to={paths.friends()} data-cc-control="profile.friends">
          Your friends
        </Link>
        : who is online, your friend requests and your friend link.
      </p>
      <Sections>
        <Section id="profile-progress" title="Progress" description="Your level and your games, all time.">
          <div className={styles.progressGrid}>
            <ProgressCard />
            <YourRank identity={session.identity} />
          </div>
        </Section>
        <PlayerConsole guest={session.identity.kind === "guest"} />
        <Section id="recent-matches" title="Recent matches" description="Your finished games, newest first.">
          <MatchHistory canAddFriends={session.identity.kind === "user"} />
        </Section>
        <PublicProfileSettings own={own} guest={session.identity.kind === "guest"} />
        <BlockedPlayers />
        {session.identity.kind === "user" && <AccountSettings />}
        {session.identity.kind === "user" && <PrivacySettings />}
      </Sections>
    </section>
  );
}
