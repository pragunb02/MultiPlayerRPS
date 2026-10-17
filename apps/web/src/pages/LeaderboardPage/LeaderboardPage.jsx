import { Link, useLocation, useParams } from "react-router";
import { getLeaderboard, LEADERBOARD_METRICS, LEADERBOARD_PERIODS, LEADERBOARDS } from "@classicade/shared";
import { paths, returnPathFor } from "../../app/paths.js";
import { AchievementIcon } from "../../art/achievements/AchievementIcon.jsx";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { Medal } from "../../art/badges/Medal.jsx";
import { rankForLevel } from "../../art/badges/ranks.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { useLeaderboard } from "../../hooks/useLeaderboard.js";
import { formatTimeLeft, useNow } from "../../hooks/useNow.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import styles from "./LeaderboardPage.module.css";

const MEDALS = Object.freeze({ 1: "gold", 2: "silver", 3: "bronze" });
const MINUTE_MS = 60_000;
/** The picture on each tab: the game's glyph for a game board, a medal for the XP boards (a star if new). Decoration. */
const TAB_ICONS = Object.freeze({ overall: "trophy", weekly: "calendar" });

function TabIcon({ board }) {
  if (board.gameId !== undefined) {
    return <GameIcon gameId={board.gameId} className={styles.tabIcon} />;
  }
  return <AchievementIcon name={TAB_ICONS[board.id]} tier="gold" className={styles.tabIcon} />;
}

/** The place, on a medal for the podium (1–3). The number stays text; the medal is decoration behind it. */
function Place({ rank }) {
  const medal = MEDALS[rank];
  return (
    <span className={styles.rank}>
      {medal && <Medal tier={medal} className={styles.medal} />}
      <span className={styles.place}>{rank}</span>
    </span>
  );
}

/** "Lv 6" beside a bare shield in the rank's tier colour; the rank's name is the tooltip. */
function Level({ level }) {
  return (
    <span className={styles.level} title={`${rankForLevel(level).name} rank`}>
      <LevelBadge level={level} size="sm" decorative numbered={false} className={styles.shield} />
      Lv {level}
    </span>
  );
}

/** "560 XP", "1 win", "12 wins". */
function formatScore(metric, score) {
  if (metric === LEADERBOARD_METRICS.XP) return `${score} XP`;
  return `${score} ${score === 1 ? "win" : "wins"}`;
}

function describeBoard(info) {
  if (info.metric === LEADERBOARD_METRICS.WINS) return `Most ${info.name} wins of all time.`;
  return info.period === LEADERBOARD_PERIODS.WEEK
    ? "XP earned this week. Everyone starts again on Monday (UTC)."
    : "Total XP of all time, from matches and daily quests.";
}

function ResetsIn({ resetsAt }) {
  const now = useNow(MINUTE_MS);
  return <p className={styles.resets}>Resets in {formatTimeLeft(resetsAt - now)}</p>;
}

/** Your own row under the list: where you stand, or why you are not on the board. */
function YouRow({ you, metric, listedRanks }) {
  const location = useLocation();
  if (you === undefined || (you.listed && listedRanks.includes(you.rank))) {
    return null;
  }
  if (you.listed) {
    return (
      <p className={`${styles.row} ${styles.you}`}>
        <span className="visually-hidden">Your rank: </span>
        <span className={styles.rank}>#{you.rank}</span>
        <span className={styles.name}>You</span>
        <span className={styles.score}>{formatScore(metric, you.score)}</span>
      </p>
    );
  }
  return (
    <p className={styles.unlisted}>
      {you.reason === "guest" ? (
        <>
          Guests aren't ranked.{" "}
          <Link to={paths.signup(returnPathFor(location))} data-cc-control="leaderboard.signup">
            Sign up
          </Link>{" "}
          to get on the leaderboard.
        </>
      ) : (
        "You're not on this board yet. Win a match to get ranked."
      )}
    </p>
  );
}

function Board({ info }) {
  const board = useLeaderboard(info.id);
  if (board.status === "loading") {
    return <p aria-busy="true">Loading the leaderboard…</p>;
  }
  if (board.status === "error") {
    return (
      <div role="alert" className={styles.problem}>
        <p>Couldn't load the leaderboard. {board.error.message}</p>
        <Button control="leaderboard.retry" variant="secondary" onClick={board.retry}>
          Try again
        </Button>
      </div>
    );
  }
  const { entries, you } = board.data;
  const yourRank = you?.listed ? you.rank : 0;
  return (
    <>
      {board.data.board.resetsAt !== undefined && <ResetsIn resetsAt={board.data.board.resetsAt} />}
      {entries.length === 0 ? (
        <p className={styles.empty}>No ranked players yet. Win a match to claim #1!</p>
      ) : (
        <ol className={styles.list} aria-label={`${info.name} rankings`}>
          {entries.map((entry) => (
            <li
              key={entry.rank}
              className={[styles.row, styles[MEDALS[entry.rank]], entry.rank === yourRank && styles.you]
                .filter(Boolean)
                .join(" ")}
              aria-current={entry.rank === yourRank ? "true" : undefined}
            >
              <Place rank={entry.rank} />
              <span className={styles.name}>
                {entry.displayName}
                {entry.rank === yourRank && <span className={styles.tag}>you</span>}
              </span>
              <Level level={entry.level} />
              <span className={styles.score}>{formatScore(info.metric, entry.score)}</span>
            </li>
          ))}
        </ol>
      )}
      <YouRow you={you} metric={info.metric} listedRanks={entries.map((entry) => entry.rank)} />
    </>
  );
}

/**
 * Leaderboards (CC-053): one URL per board — overall XP, this week, and wins per game — with tabs as plain links,
 * so Back and Forward move between boards. Accounts only; guests are invited to sign up.
 */
export function LeaderboardPage() {
  const { board: boardId } = useParams();
  const info = getLeaderboard(String(boardId));
  if (info === undefined) {
    return <NotFoundPage />;
  }
  return (
    <section className={styles.page}>
      <PageTitle>{`${info.name} · Leaderboards`}</PageTitle>
      <h1>Leaderboards</h1>
      <nav aria-label="Leaderboards">
        <ul className={styles.tabs}>
          {LEADERBOARDS.map((tab) => (
            <li key={tab.id}>
              <Link
                to={paths.leaderboards(tab.id)}
                className={styles.tab}
                data-cc-control="leaderboard.tab"
                aria-current={tab.id === info.id ? "page" : undefined}
              >
                <TabIcon board={tab} />
                {tab.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.card}>
        <h2>{info.metric === LEADERBOARD_METRICS.WINS ? `${info.name} wins` : info.name}</h2>
        <p className={styles.muted}>{describeBoard(info)}</p>
        <Board key={info.id} info={info} />
      </div>
    </section>
  );
}
