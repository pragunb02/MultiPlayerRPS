import { Link } from "react-router";
import { getLeaderboard } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { AchievementIcon } from "../../art/achievements/AchievementIcon.jsx";
import { useLeaderboard } from "../../hooks/useLeaderboard.js";
import { Button } from "../Button/Button.jsx";
import { Card, CardFooter, CardHeader } from "../Card/Card.jsx";
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
 * Your place on the XP leaderboards, for the profile. A guest is ranked too, and is asked to sign up to keep its
 * place (ADR-060).
 *
 * @param {{ identity: { kind: string } }} props
 */
export function YourRank({ identity }) {
  return (
    <Card as="section" aria-labelledby="your-rank">
      <CardHeader
        id="your-rank"
        title={
          <span className={styles.heading}>
            <AchievementIcon name="trophy" tier="gold" className={styles.trophy} />
            Your rank
          </span>
        }
        description="Your place on the XP boards: all time, and this week."
      />
      <dl className={styles.stats}>
        {BOARDS.map((boardId) => (
          <Standing key={boardId} boardId={boardId} />
        ))}
      </dl>
      {identity.kind === "guest" && (
        <p className={styles.muted}>
          <Link to={paths.signup(paths.profile())} data-cc-control="rank.signup">
            Sign up
          </Link>{" "}
          to keep your place on the boards.
        </p>
      )}
      <CardFooter>
        <Button as="link" to={paths.leaderboards()} control="rank.leaderboards" variant="secondary" size="sm">
          See the leaderboards
        </Button>
      </CardFooter>
    </Card>
  );
}
