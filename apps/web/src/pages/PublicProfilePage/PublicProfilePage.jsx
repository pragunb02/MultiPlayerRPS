import { Link, useParams } from "react-router";
import { paths } from "../../app/paths.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { rankForLevel } from "../../art/badges/ranks.js";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { PROFILE_COPY } from "../../components/Profile/profileCopy.js";
import { usePlayerProfile } from "../../hooks/useProfile.js";
import styles from "./PublicProfilePage.module.css";

/** "1532", or "1500?" while the rating is provisional (ADR-027.3), or "Not rated yet" before the first rated game. */
const chessRating = ({ rating, provisional, games }) =>
  games === 0 ? "Not rated yet" : `${rating}${provisional ? "?" : ""}`;

/** The public part of an adult's profile: level, games, wins and the chess rating (CC-034). Nothing else. */
function PublicStats({ player }) {
  return (
    <div className={styles.card}>
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
          <dd>{chessRating(player.chess)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** The top of every profile that is found: the avatar and the name. A hidden profile shows the silhouette only. */
function Header({ player }) {
  return (
    <header className={styles.header}>
      <Avatar avatar={player.hidden ? undefined : player.avatar} size={96} />
      <h1 className={player.hidden ? styles.hidden : undefined}>{player.displayName}</h1>
    </header>
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
        <p aria-busy="true">Loading the profile…</p>
      </section>
    );
  }
  if (profile.status === "notFound") {
    return (
      <section className={styles.page}>
        <PageTitle>Player not found</PageTitle>
        <h1>Player not found</h1>
        <Bilingual copy={PROFILE_COPY.notFound} />
        <Link to={paths.leaderboards()} data-cc-control="player.leaderboards">
          See the leaderboards
        </Link>
      </section>
    );
  }
  if (profile.status === "error") {
    return (
      <section className={styles.page}>
        <PageTitle>Player profile</PageTitle>
        <div role="alert" className={styles.problem}>
          <p>Couldn&apos;t load the profile. {profile.error.message}</p>
          <Button control="player.retry" variant="secondary" onClick={profile.retry}>
            Try again
          </Button>
        </div>
      </section>
    );
  }
  const { player } = profile;
  return (
    <section className={styles.page}>
      <PageTitle>{player.displayName}</PageTitle>
      <Header player={player} />
      {player.own && (
        <p className={styles.own}>
          <Bilingual copy={PROFILE_COPY.own} as="span" />{" "}
          <Link to={paths.profile()} data-cc-control="player.own_profile">
            Your profile
          </Link>
        </p>
      )}
      {player.hidden && <Bilingual copy={PROFILE_COPY.hidden} />}
      {player.private && <Bilingual copy={PROFILE_COPY.private} />}
      {player.stats !== undefined && <PublicStats player={player} />}
    </section>
  );
}
