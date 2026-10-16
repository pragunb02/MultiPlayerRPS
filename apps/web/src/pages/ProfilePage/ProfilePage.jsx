import { Link } from "react-router";
import { getGame } from "@classicade/shared";
import { Button } from "../../components/Button/Button.jsx";
import { useMatchHistory } from "../../hooks/useMatchHistory.js";
import { useProgress } from "../../hooks/useProgress.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./ProfilePage.module.css";

const OUTCOME_LABEL = { win: "Won", loss: "Lost", draw: "Draw" };
const formatDate = (ms) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function ProgressCard() {
  const { status, progress, error } = useProgress();
  if (status === "loading") return <p>Loading progress…</p>;
  if (status === "error") return <p role="alert">Couldn't load progress. {error.message}</p>;
  const percent =
    progress.xpForNextLevel === 0 ? 100 : Math.round((progress.xpIntoLevel / progress.xpForNextLevel) * 100);
  return (
    <div className={styles.card}>
      <p className={styles.level}>Level {progress.level}</p>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label="Progress to next level"
        aria-valuemin={0}
        aria-valuemax={progress.xpForNextLevel}
        aria-valuenow={progress.xpIntoLevel}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
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

function MatchHistory({ you }) {
  const history = useMatchHistory();
  if (history.status === "loading") return <p>Loading matches…</p>;
  if (history.status === "error") return <p role="alert">Couldn't load matches. {history.error.message}</p>;
  if (history.matches.length === 0) {
    return (
      <p>
        No games yet. <Link to="/">Play one</Link>
      </p>
    );
  }
  return (
    <>
      <ul className={styles.matches} aria-label="Match history">
        {history.matches.map((match) => {
          const opponents = match.players.filter((p) => p.playerId !== you).map((p) => p.displayName);
          return (
            <li key={match.matchId} className={styles.match}>
              <span className={`${styles.badge} ${styles[match.outcomeForYou]}`}>
                {OUTCOME_LABEL[match.outcomeForYou]}
              </span>
              <span>
                {getGame(match.gameId)?.name ?? match.gameId} vs {opponents.join(", ") || "—"}
              </span>
              <time className={styles.muted} dateTime={new Date(match.endedAt).toISOString()}>
                {formatDate(match.endedAt)}
              </time>
            </li>
          );
        })}
      </ul>
      {history.hasMore && (
        <Button variant="secondary" onClick={history.loadMore}>
          Load more
        </Button>
      )}
    </>
  );
}

/** Your level, stats and match history — for guests and account holders alike. */
export function ProfilePage() {
  const session = useSession();
  if (session.status === "loading") {
    return <p>Loading…</p>;
  }
  if (session.identity === undefined) {
    return (
      <section>
        <h1>Your profile</h1>
        <p>
          Play a game or <Link to="/login?next=/profile">log in</Link> to see your progress.
        </p>
      </section>
    );
  }
  return (
    <section className={styles.page}>
      <h1>{session.identity.displayName}</h1>
      {session.identity.kind === "guest" && (
        <p className={styles.muted}>
          You're playing as a guest. <Link to="/signup?next=/profile">Create an account</Link> to keep your
          name.
        </p>
      )}
      <ProgressCard />
      <h2>Recent matches</h2>
      <MatchHistory you={session.identity.id} />
    </section>
  );
}
