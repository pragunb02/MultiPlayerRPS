import { Link } from "react-router";
import { getLeaderboard } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useLeaderboard } from "../../hooks/useLeaderboard.js";
import styles from "./YourRank.module.css";

const BOARDS = Object.freeze(["overall", "weekly"]);

function Standing({ boardId }) {
  const { status, data } = useLeaderboard(boardId, { limit: 1 });
  const name = getLeaderboard(boardId).name;
  let value = "…";
  if (status === "error") value = "—";
  if (status === "ready") value = data.you?.listed ? `#${data.you.rank}` : "Unranked";
  return (
    <div className={styles.stat}>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Your place on the XP leaderboards, for the profile. Guests are never ranked, so they get a sign-up nudge instead.
 *
 * @param {{ identity: { kind: string } }} props
 */
export function YourRank({ identity }) {
  return (
    <section className={styles.card} aria-labelledby="your-rank">
      <h2 id="your-rank">Your rank</h2>
      {identity.kind === "guest" ? (
        <p className={styles.muted}>
          Guests aren't ranked. <Link to={paths.signup(paths.profile())}>Sign up</Link> to get on the
          leaderboard.
        </p>
      ) : (
        <dl className={styles.stats}>
          {BOARDS.map((boardId) => (
            <Standing key={boardId} boardId={boardId} />
          ))}
        </dl>
      )}
      <Link to={paths.leaderboards()}>See the leaderboards</Link>
    </section>
  );
}
