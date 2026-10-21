import { useState } from "react";
import { Link, useParams } from "react-router";
import { paths } from "../../app/paths.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { rankForLevel } from "../../art/badges/ranks.js";
import { GameOver404 } from "../../art/illustrations/GameOver404.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { Card } from "../../components/Card/Card.jsx";
import { Section } from "../../components/Page/Page.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { PROFILE_COPY } from "../../components/Profile/profileCopy.js";
import { ReportDialog } from "../../components/Report/ReportDialog.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
import { usePlayerProfile } from "../../hooks/useProfile.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./PublicProfilePage.module.css";

/** "1532", or "1500?" while the rating is provisional (ADR-027.3), or "Unrated" before the first rated game. */
const chessRating = ({ rating, provisional, games }) =>
  games === 0 ? "Unrated" : `${rating}${provisional ? "?" : ""}`;

/** The public part of an adult's profile: level, games, wins and the chess rating (CC-034). Nothing else. */
function PublicStats({ player }) {
  return (
    <Section id="player-stats" title="Stats" description="Level, games played and won, and rating, all time.">
      <Card variant="raised" as="div">
        <div className={styles.levelRow}>
          <LevelBadge level={player.level} size="md" decorative />
          <div>
            <p className={styles.level}>Level {player.level}</p>
            <p className={styles.rank}>{rankForLevel(player.level).name} rank</p>
          </div>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Played</dt>
            <dd>{player.stats.gamesPlayed}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd>{player.stats.wins}</dd>
          </div>
          <div>
            <dt>Chess rating</dt>
            <dd className={player.chess.games === 0 ? styles.unrated : undefined}>
              {chessRating(player.chess)}
            </dd>
          </div>
        </dl>
      </Card>
    </Section>
  );
}

/** The top of every profile that is found: the avatar and the name, also of a hidden profile (owner, ADR-065). */
function Header({ player }) {
  return (
    <header className={styles.header}>
      <Avatar avatar={player.avatar} size={96} />
      <h1 className={player.hidden ? styles.hidden : undefined}>{player.displayName}</h1>
    </header>
  );
}

/**
 * Report on a profile (CC-044, ADR-071): for a signed-in viewer (a guest too) looking at someone else's profile that
 * shows a name. A hidden profile shows nothing to report, and the server refuses it alike. The player is named by the
 * handle only.
 */
function ReportFromProfile({ player }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  if (session.identity === undefined || player.own === true || player.hidden === true) return null;
  return (
    <>
      <Button
        control="player.report"
        variant="ghost"
        size="sm"
        className={styles.report}
        aria-label={`Report ${player.displayName}`}
        onClick={() => setOpen(true)}
      >
        Report
      </Button>
      {open && (
        <ReportDialog
          name={player.displayName}
          target={{ handle: player.handle }}
          canBlock
          onBlocked={() => undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * A player's profile at `/players/:handle` (CC-034, ADR-065), reached from a leaderboard row or a past opponent. The
 * server decides everything it shows: an adult's public profile, an adult's private one with the name and avatar
 * only, "Hidden player" for anyone not surely an adult, and not found for a handle nobody has or a blocked pair.
 */
export function PublicProfilePage() {
  const { handle } = useParams();
  const profile = usePlayerProfile(String(handle));

  if (profile.status === "loading") {
    return (
      <section className={styles.page}>
        <PageTitle>Player profile</PageTitle>
        <Skeleton label="Loading the profile" shape="card" />
      </section>
    );
  }
  if (profile.status === "notFound") {
    return (
      <section className={styles.page}>
        <PageTitle>Player not found</PageTitle>
        <EmptyState
          title="Player not found"
          headingLevel={1}
          art={<GameOver404 />}
          action={
            <Button as="link" to={paths.leaderboards()} control="player.leaderboards">
              See the leaderboards
            </Button>
          }
        >
          <Bilingual copy={PROFILE_COPY.notFound} as="span" />
        </EmptyState>
      </section>
    );
  }
  if (profile.status === "error") {
    return (
      <section className={styles.page}>
        <PageTitle>Player profile</PageTitle>
        <ErrorState
          title={`Couldn't load the profile. ${profile.error.message}`}
          control="player"
          onRetry={profile.retry}
        />
      </section>
    );
  }
  const { player } = profile;
  return (
    <section className={styles.page}>
      <PageTitle>{player.displayName}</PageTitle>
      <Header player={player} />
      {player.own && (
        <Card variant="notice" tone="info" as="div">
          <p className={styles.own}>
            <Bilingual copy={PROFILE_COPY.own} as="span" />{" "}
            <Link to={paths.profile()} data-cc-control="player.own_profile">
              Your profile
            </Link>
          </p>
        </Card>
      )}
      {player.hidden && <Bilingual copy={PROFILE_COPY.hidden} />}
      {player.private && <Bilingual copy={PROFILE_COPY.private} />}
      {player.stats !== undefined && <PublicStats player={player} />}
      <ReportFromProfile player={player} />
    </section>
  );
}
