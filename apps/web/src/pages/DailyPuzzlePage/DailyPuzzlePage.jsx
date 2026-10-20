import { Suspense, useState } from "react";
import { useParams } from "react-router";
import { DAILY_PUZZLE_STATUS, getDailyPuzzle, isDailyPuzzleEnded } from "@classicade/shared";
import { Button } from "../../components/Button/Button.jsx";
import { DailyShare } from "../../components/DailyShare/DailyShare.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { DAILY_KINDS } from "../../games/daily/dailyKinds.js";
import { useAction } from "../../hooks/useAction.js";
import { useDailyPuzzle } from "../../hooks/useDailyPuzzle.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import styles from "./DailyPuzzlePage.module.css";

const LICHESS_DATABASE = "https://database.lichess.org/#puzzles";

/** The puzzle's day in words, such as "Tuesday 20 October". The day is a date, so it is read as one in UTC. */
const dayInWords = (day) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

/** When the next puzzle comes, in the player's own time, such as "12:00 am" in India. */
const timeInWords = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Mistakes as marks, with the words beside them for anyone who cannot see the marks. */
function Mistakes({ puzzle }) {
  const left = puzzle.maxMistakes - puzzle.mistakes;
  return (
    <p className={styles.mistakes}>
      <span className={styles.marks} aria-hidden="true">
        {Array.from({ length: puzzle.maxMistakes }, (_, index) => (
          <span key={index} className={index < left ? styles.markLeft : styles.markUsed} />
        ))}
      </span>
      {left === 1 ? "1 try left" : `${left} tries left`}
    </p>
  );
}

/** Hints are optional: each one shows a 💡 on the share card, and the button says when none are left. */
function Hints({ puzzle, action }) {
  return (
    <div className={styles.hints}>
      <Button
        control="daily.hint"
        variant="secondary"
        action={action}
        reason={puzzle.hintsLeft === 0 ? "No hints left today" : ""}
      >
        {`Get a hint (${puzzle.hintsLeft} left)`}
      </Button>
      {puzzle.hints.length > 0 && (
        <ol className={styles.hintList} aria-label="Hints">
          {puzzle.hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The day's result: solved or not, the solution, the share and when the next puzzle comes. */
function Result({ puzzle }) {
  const solved = puzzle.status === DAILY_PUZZLE_STATUS.SOLVED;
  return (
    <section className={styles.result} aria-labelledby="daily-result">
      <h2 id="daily-result">{solved ? "Solved!" : "Not this time"}</h2>
      <p>
        Solution: <span className={styles.solution}>{puzzle.solution.join(" ")}</span>
      </p>
      <DailyShare puzzle={puzzle} />
      <p className={styles.next}>Next puzzle at {timeInWords(puzzle.nextAt)}.</p>
      <a href={puzzle.sourceUrl} target="_blank" rel="noopener noreferrer" data-cc-control="daily.source">
        See this puzzle on Lichess
      </a>
    </section>
  );
}

/** The puzzle's own streak, apart from the daily play streak (ADR-061). */
function Streak({ streak }) {
  if (streak.best === 0) {
    return (
      <section className={styles.streak} aria-label="Puzzle streak">
        <p className={styles.atRisk}>Solve a puzzle each day to build a streak.</p>
      </section>
    );
  }
  return (
    <section className={styles.streak} aria-label="Puzzle streak">
      <p className={styles.streakLine}>
        <span aria-hidden="true">🔥 </span>
        Puzzle streak: {streak.current} {streak.current === 1 ? "day" : "days"}
        <span className={styles.best}>Best {streak.best}</span>
      </p>
      {streak.atRisk && <p className={styles.atRisk}>Solve today's puzzle to keep it going.</p>}
    </section>
  );
}

/**
 * Today's puzzle of one kind: the board, what to find, tries left, hints, and once it ends the result to share.
 * Visitors see the puzzle too, and their first move or hint starts a guest session (CC-144, ADR-061).
 */
function DailyPuzzle({ kind, info, view }) {
  const daily = useDailyPuzzle(kind);
  const [said, setSaid] = useState("");
  const move = useAction(
    async (boardMove) => {
      const answer = await daily.play(boardMove);
      setSaid(view.announce(answer));
      return answer;
    },
    { id: "daily.move" },
  );
  const hint = useAction(
    async () => {
      const answer = await daily.hint();
      setSaid(`Hint: ${answer.hint}`);
    },
    { id: "daily.hint" },
  );

  if (daily.status === "loading") {
    return <p role="status">Loading today's puzzle…</p>;
  }
  if (daily.status === "error") {
    return (
      <div role="alert" className={styles.failed}>
        <p>Couldn't load today's puzzle. {daily.error.message}</p>
        <Button control="daily.reload" variant="secondary" onClick={daily.reload}>
          Try again
        </Button>
      </div>
    );
  }

  const { puzzle } = daily;
  const ended = isDailyPuzzleEnded(puzzle.status);
  const reason = ended ? "Today's puzzle is over. Come back tomorrow" : move.busy ? "Sending your move" : "";
  const { Board } = view;
  return (
    <div className={styles.layout}>
      <section className={styles.boardColumn} aria-labelledby="daily-heading">
        <header className={styles.header}>
          <p className={styles.day}>{dayInWords(puzzle.day)}</p>
          <h1 id="daily-heading">
            {info.name} #{puzzle.number}
          </h1>
          <p className={styles.task}>
            {view.task(puzzle)} <span className={styles.rating}>Rated {puzzle.rating}</span>
          </p>
        </header>
        <Suspense fallback={<p role="status">Loading the board…</p>}>
          <Board puzzle={puzzle} interactive={reason === ""} reason={reason} onMove={move.run} />
        </Suspense>
        {move.error !== undefined && (
          <p role="alert" className={styles.problem}>
            {move.error.message}
          </p>
        )}
        <p className="visually-hidden" aria-live="polite">
          {said}
        </p>
      </section>
      <aside className={styles.panel} aria-label="Today's puzzle">
        {ended ? (
          <Result puzzle={puzzle} />
        ) : (
          <>
            <Mistakes puzzle={puzzle} />
            <Hints puzzle={puzzle} action={hint} />
          </>
        )}
        <Streak streak={puzzle.streak} />
        <p className={styles.credit}>
          Puzzles come from the{" "}
          <a href={LICHESS_DATABASE} target="_blank" rel="noopener noreferrer" data-cc-control="daily.credit">
            Lichess puzzle database
          </a>
          , free for all under CC0.
        </p>
      </aside>
    </div>
  );
}

/** `/daily/:kind`: today's daily puzzle (CC-144). A kind with no puzzle is the not found page. */
export function DailyPuzzlePage() {
  const { kind = "" } = useParams();
  const info = getDailyPuzzle(kind);
  const view = Object.hasOwn(DAILY_KINDS, kind) ? DAILY_KINDS[kind] : undefined;
  if (info === undefined || view === undefined) {
    return <NotFoundPage />;
  }
  return (
    <>
      <PageTitle>{info.name}</PageTitle>
      <DailyPuzzle kind={kind} info={info} view={view} />
    </>
  );
}
