import { Link, useLocation, useParams } from "react-router";
import {
  getLeaderboard,
  HIDDEN_PLAYER_NAME,
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIODS,
  LEADERBOARDS,
} from "@classicade/shared";
import { paths, returnPathFor } from "../../app/paths.js";
import { AchievementIcon } from "../../art/achievements/AchievementIcon.jsx";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { Medal } from "../../art/badges/Medal.jsx";
import { rankForLevel } from "../../art/badges/ranks.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { useLeaderboard } from "../../hooks/useLeaderboard.js";
import { formatTimeLeft, useNow } from "../../hooks/useNow.js";
import { useSession } from "../../hooks/useSession.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import styles from "./LeaderboardPage.module.css";

const MEDALS = Object.freeze({ 1: "gold", 2: "silver", 3: "bronze" });
// A board with fewer entries than this looks empty on its own, so it gets the "How to get on the board" panel beside
// it. It is the leaderboard threshold of ADR-029, until its switch is built (CC-228).
const FEW_ENTRIES = 25;
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

/**
 * The name on a row, with the player's avatar. An adult account's name links to their profile (CC-034). A hidden row
 * shows the avatar but never a link, and neither does a guest's.
 */
function RowName({ entry, you }) {
  return (
    <span className={[styles.name, entry.hidden && styles.hidden].filter(Boolean).join(" ")}>
      <Avatar avatar={entry.avatar} size={28} />
      <span className={styles.nameText}>
        {entry.profile === undefined ? (
          entry.displayName
        ) : (
          <Link to={paths.player(entry.profile)} data-cc-control="leaderboard.player">
            {entry.displayName}
          </Link>
        )}
      </span>
      {you && <span className={styles.tag}>you</span>}
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

/** Your own row under the list: where you stand, or that you are not on the board yet. */
function YouRow({ you, metric, listedRanks }) {
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
  return <p className={styles.unlisted}>You're not on this board yet. Win a match to get ranked.</p>;
}

/** A guest is ranked under its Guest name, and its rows move to the account it signs up for (ADR-060). */
function KeepYourPlace() {
  const location = useLocation();
  return (
    <p className={styles.unlisted}>
      <Link to={paths.signup(returnPathFor(location))} data-cc-control="leaderboard.signup">
        Sign up
      </Link>{" "}
      to keep your place on the boards.
    </p>
  );
}

/** What counts on this board, in one short sentence. */
function whatCounts(info) {
  if (info.metric === LEADERBOARD_METRICS.WINS) return `Win a game of ${info.name} against another player.`;
  return info.period === LEADERBOARD_PERIODS.WEEK
    ? "Earn XP from games and daily quests this week."
    : "Earn XP from games and daily quests.";
}

/**
 * The panel beside a board with few entries (CC-259): how a player gets on it, and one button to start. It holds
 * rules only, never numbers, so it can't make the site look busier than it is (ADR-029).
 */
function HowToGetOn({ info }) {
  return (
    <aside className={styles.howTo} aria-labelledby="how-to-get-on">
      <h2 id="how-to-get-on">How to get on the board</h2>
      <ol className={styles.steps}>
        <li>Play as a guest or with an account. Guests are ranked under their Guest name.</li>
        <li>{whatCounts(info)}</li>
        <li>Games against the computer never count here.</li>
      </ol>
      <Link
        to={info.gameId === undefined ? paths.home() : paths.game(info.gameId)}
        className={styles.play}
        data-cc-control="leaderboard.play"
      >
        {info.gameId === undefined ? "Play a game" : `Play ${info.name}`}
      </Link>
    </aside>
  );
}

/** The board's card: its name and what it counts, with the list (or its loading and error states) inside. */
function BoardCard({ info, children }) {
  return (
    <div className={styles.card}>
      <h2>{info.metric === LEADERBOARD_METRICS.WINS ? `${info.name} wins` : info.name}</h2>
      <p className={styles.muted}>{describeBoard(info)}</p>
      {children}
    </div>
  );
}

function Board({ info }) {
  const board = useLeaderboard(info.id);
  const { identity } = useSession();
  if (board.status === "loading") {
    return (
      <BoardCard info={info}>
        <p aria-busy="true">Loading the leaderboard…</p>
      </BoardCard>
    );
  }
  if (board.status === "error") {
    return (
      <BoardCard info={info}>
        <div role="alert" className={styles.problem}>
          <p>Couldn't load the leaderboard. {board.error.message}</p>
          <Button control="leaderboard.retry" variant="secondary" onClick={board.retry}>
            Try again
          </Button>
        </div>
      </BoardCard>
    );
  }
  const { entries, you } = board.data;
  const yourRank = you?.listed ? you.rank : 0;
  const few = entries.length < FEW_ENTRIES;
  return (
    <div className={few ? styles.withHowTo : styles.alone}>
      <BoardCard info={info}>
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
                <RowName entry={entry} you={entry.rank === yourRank} />
                <Level level={entry.level} />
                <span className={styles.score}>{formatScore(info.metric, entry.score)}</span>
              </li>
            ))}
          </ol>
        )}
        {entries.some((entry) => entry.hidden) && (
          <p className={styles.muted}>
            {HIDDEN_PLAYER_NAME} is a player under 18 or one who has not said their age. Their names stay
            private.
          </p>
        )}
        <YouRow you={you} metric={info.metric} listedRanks={entries.map((entry) => entry.rank)} />
        {you !== undefined && identity?.kind === "guest" && <KeepYourPlace />}
      </BoardCard>
      {few && <HowToGetOn info={info} />}
    </div>
  );
}

/**
 * Leaderboards (CC-053): one URL per board (overall XP, this week, and wins per game) with tabs as plain links,
 * so Back and Forward move between boards. Guests are ranked under their Guest name and are invited to sign up to
 * keep their place (ADR-060).
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
      <Board key={info.id} info={info} />
    </section>
  );
}
