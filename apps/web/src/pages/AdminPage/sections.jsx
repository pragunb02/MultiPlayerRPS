import { BarChart, ChartFigure, Heatmap, RankBars } from "./charts.jsx";
import {
  boardName,
  formatChange,
  formatCount,
  formatDecimal,
  formatSeconds,
  formatShare,
  gameName,
  WEEKDAYS,
} from "./format.js";
import styles from "./AdminPage.module.css";

// The pages of the owner console (CC-233). Each takes the report and draws one part of it. The definitions of
// the numbers are in docs/tickets/CC-233.md, and short versions are in the notes under each heading.

const GAME_TONES = Object.freeze({ rps: "rps", tictactoe: "tictactoe", chess: "chess" });
const bucketName = Object.freeze({ day: "Day", week: "Week from", month: "Month" });

/** How each headline is named and shown. */
const HEADLINES = Object.freeze({
  activePlayers: { label: "Active players", format: formatCount, note: "Finished at least one match" },
  matches: { label: "Matches finished", format: formatCount, note: "All games" },
  newPlayers: { label: "New players", format: formatCount, note: "First match ever in this period" },
  weeklyReturning: {
    label: "Weekly returning players",
    format: formatCount,
    note: "North Star: real play on 3 or more days in the latest week",
  },
  matchesPerPlayer: {
    label: "Matches per player",
    format: formatDecimal,
    note: "Average for active players",
  },
  guestsConverted: {
    label: "Guests who saved progress",
    format: formatCount,
    note: "Made or opened an account",
  },
  conversionRate: { label: "Guest to account", format: formatShare, note: "Share of guests who played" },
});

/**
 * One number with its name, the period before and the change.
 *
 * @param {{ label: string, value: string, note: string, previous?: string, change?: string }} props
 */
function Tile({ label, value, note, previous, change }) {
  return (
    <div className={styles.tile}>
      <dt className={styles.tileLabel}>{label}</dt>
      <dd className={styles.tileValue}>{value}</dd>
      <dd className={styles.tileNote}>
        {note}
        {previous !== undefined && (
          <>
            <br />
            Before: {previous}
            {change ? ` (${change})` : ""}
          </>
        )}
      </dd>
    </div>
  );
}

const seriesOf = (rows, pick) => rows.map((row) => ({ label: row.bucket, values: pick(row) }));
const summaryOf = (what, rows, values) => {
  const numbers = values.filter((value) => typeof value === "number");
  const most = numbers.length === 0 ? 0 : Math.max(...numbers);
  return `${what}, ${rows.length} bars from ${rows[0].bucket} to ${rows[rows.length - 1].bucket}. Highest ${formatCount(most)}. The same numbers are in the table below.`;
};

/** @param {{ report: object }} props */
export function Overview({ report }) {
  const { range } = report;
  const returning = report.players.weeklyReturning;
  return (
    <>
      <dl className={styles.tiles} aria-label="Headline numbers">
        {report.overview.headlines.map(({ id, value, previous, change }) => {
          const info = HEADLINES[id];
          return (
            <Tile
              key={id}
              label={info.label}
              value={info.format(value)}
              note={info.note}
              previous={info.format(previous)}
              change={formatChange(change)}
            />
          );
        })}
      </dl>
      <p className={styles.compare}>
        Compared with {range.previous.from} to {range.previous.to}, the same number of days just before.
      </p>
      <ChartFigure
        id="weekly-returning"
        title="Weekly returning players (North Star)"
        note="Players with a counted match on 3 or more different days of a week, Monday to Sunday, India time. Guardrails: the share who played a person that week, and the share who are accounts."
        range={range}
        rows={returning}
        columns={[
          { label: "Week from", value: (row) => row.week },
          { label: "Returning players", value: (row) => row.players, format: "count" },
          { label: "Played a person", value: (row) => row.withPerson, format: "share" },
          { label: "Accounts", value: (row) => row.accounts, format: "share" },
          { label: "Week over", value: (row) => (row.complete ? "yes" : "not yet") },
        ]}
      >
        <BarChart
          summary={summaryOf(
            "Weekly returning players",
            returning.map((row) => ({ bucket: row.week })),
            returning.map((row) => row.players),
          )}
          rows={returning.map((row) => ({ label: row.week, values: { players: row.players } }))}
          series={[{ key: "players", label: "Returning players", tone: "accent" }]}
        />
      </ChartFigure>
      <ComingNext />
    </>
  );
}

/** @param {{ report: object }} props */
export function Players({ report }) {
  const { range, players } = report;
  const { summary } = players;
  return (
    <>
      <dl className={styles.tiles} aria-label="Activity">
        <Tile
          label="Daily active, average"
          value={formatDecimal(summary.dailyAverage)}
          note="Over this period"
        />
        <Tile label="Weekly active" value={formatCount(summary.weekly)} note={`7 days to ${range.to}`} />
        <Tile label="Monthly active" value={formatCount(summary.monthly)} note={`30 days to ${range.to}`} />
        <Tile
          label="Stickiness"
          value={formatShare(summary.stickiness)}
          note="Daily average of the last 30 days over monthly active"
        />
        <Tile label="Guests" value={formatShare(players.kinds.guestShare)} note="Share of active players" />
      </dl>
      <ChartFigure
        id="active-players"
        title="Active players"
        note="Different players who finished a match in each period. A player counts once per bar."
        range={range}
        rows={players.active}
        columns={[
          { label: bucketName[range.bucket], value: (row) => row.bucket },
          { label: "Players", value: (row) => row.players, format: "count" },
          { label: "Guests", value: (row) => row.guests, format: "count" },
          { label: "Accounts", value: (row) => row.accounts, format: "count" },
        ]}
      >
        <BarChart
          summary={summaryOf(
            "Active players",
            players.active,
            players.active.map((row) => row.players),
          )}
          rows={seriesOf(players.active, (row) => ({ accounts: row.accounts, guests: row.guests }))}
          series={[
            { key: "accounts", label: "Accounts", tone: "primary" },
            { key: "guests", label: "Guests", tone: "xp" },
          ]}
        />
      </ChartFigure>
      <ChartFigure
        id="new-players"
        title="New players"
        note="Players whose first finished match ever falls in each period."
        range={range}
        rows={players.newPlayers}
        columns={[
          { label: bucketName[range.bucket], value: (row) => row.bucket },
          { label: "New players", value: (row) => row.players, format: "count" },
        ]}
      >
        <BarChart
          summary={summaryOf(
            "New players",
            players.newPlayers,
            players.newPlayers.map((row) => row.players),
          )}
          rows={seriesOf(players.newPlayers, (row) => ({ players: row.players }))}
          series={[{ key: "players", label: "New players", tone: "gold" }]}
        />
      </ChartFigure>
    </>
  );
}

/** @param {{ report: object }} props */
export function Games({ report }) {
  const { range, games } = report;
  const series = games.gameIds.map((gameId) => ({
    key: gameId,
    label: gameName(gameId),
    tone: GAME_TONES[gameId] ?? "primary",
  }));
  const rematch = new Map(games.rematch.byGame.map((row) => [row.gameId, row.share]));
  const durations = new Map(games.durations.map((row) => [row.gameId, row.medianSeconds]));
  const { mix, fairPlay } = games;
  return (
    <>
      <ChartFigure
        id="matches"
        title="Matches finished"
        note="Every finished match, by game."
        range={range}
        rows={games.matches}
        columns={[
          { label: bucketName[range.bucket], value: (row) => row.bucket },
          { label: "All games", value: (row) => row.total, format: "count" },
          ...games.gameIds.map((gameId) => ({
            label: gameName(gameId),
            value: (row) => row.byGame[gameId],
            format: "count",
          })),
        ]}
      >
        <BarChart
          summary={summaryOf(
            "Matches finished",
            games.matches,
            games.matches.map((row) => row.total),
          )}
          rows={seriesOf(games.matches, (row) => row.byGame)}
          series={series}
        />
      </ChartFigure>
      <ChartFigure
        id="games"
        title="Games"
        note="Each game's share of matches, the median match length, and the rematch rate: the share of matches played again in the same room."
        range={range}
        rows={games.popularity}
        columns={[
          { label: "Game", value: (row) => gameName(row.gameId) },
          { label: "Matches", value: (row) => row.matches, format: "count" },
          { label: "Share", value: (row) => row.share, format: "share" },
          { label: "Median length", value: (row) => durations.get(row.gameId), format: "seconds" },
          { label: "Rematch rate", value: (row) => rematch.get(row.gameId), format: "share" },
        ]}
      >
        <RankBars
          items={games.popularity.map((row) => ({
            label: gameName(row.gameId),
            value: row.matches,
            text: `${formatShare(row.share)} · ${formatSeconds(durations.get(row.gameId))}`,
          }))}
        />
      </ChartFigure>
      <ChartFigure
        id="who-played"
        title="Who played whom"
        note={`Matches between accounts only, guests only, or both. Bot matches light up when characters arrive (CC-138). Rematch rate overall: ${formatShare(games.rematch.overall)}.`}
        range={range}
        tableOnly
        rows={[
          { label: "Accounts only", value: mix.accountsOnly },
          { label: "Guests only", value: mix.guestsOnly },
          { label: "Accounts and guests", value: mix.mixed },
          { label: "With a bot", value: mix.withBot },
          { label: "All matches", value: mix.total },
        ]}
        columns={[
          { label: "Players", value: (row) => row.label },
          { label: "Matches", value: (row) => row.value, format: "count" },
        ]}
      />
      <ChartFigure
        id="fair-play"
        title="Did not count (anti-farming)"
        note={`Of ${formatCount(fairPlay.judgedSeats)} judged player results, ${formatShare(fairPlay.share)} did not count (CC-095). A rising share means farming, or a limit too tight for honest play.`}
        range={range}
        tableOnly
        rows={fairPlay.reasons}
        columns={[
          { label: "Reason", value: (row) => row.reason },
          { label: "Results", value: (row) => row.seats, format: "count" },
          { label: "Share", value: (row) => row.share, format: "share" },
        ]}
      />
    </>
  );
}

const RETURNS = Object.freeze({ 1: "Day 1", 7: "Day 7", 30: "Day 30" });

/** @param {{ report: object }} props */
export function Retention({ report }) {
  const { range } = report;
  const cohorts = report.retention.cohorts;
  const column = (after) => [
    {
      label: `${RETURNS[after]} return`,
      value: (row) => row.returns.find((cell) => cell.after === after).share,
      format: "share",
    },
    {
      label: `${RETURNS[after]} ±`,
      value: (row) => row.returns.find((cell) => cell.after === after).margin,
      format: "share",
    },
    {
      label: `${RETURNS[after]} counted`,
      value: (row) => row.returns.find((cell) => cell.after === after).eligible,
      format: "count",
    },
  ];
  return (
    <ChartFigure
      id="retention"
      title="Cohort retention"
      note="Players grouped by the week of their first match. A return is a finished match exactly 1, 7 or 30 days after the first day. Only players whose return day is over are counted. ± is the 95% margin of error: trust a cohort of 300 or more."
      range={range}
      tableOnly
      rows={cohorts}
      columns={[
        { label: "First week from", value: (row) => row.week },
        { label: "New players", value: (row) => row.players, format: "count" },
        ...column(1),
        ...column(7),
        ...column(30),
      ]}
    />
  );
}

/** @param {{ report: object }} props */
export function Conversion({ report }) {
  const { range, conversion } = report;
  return (
    <>
      <dl className={styles.tiles} aria-label="Conversion">
        <Tile
          label="Guest to account"
          value={formatShare(conversion.rate)}
          note="Guests with a match who saved their progress"
        />
        <Tile
          label="Guests who saved progress"
          value={formatCount(conversion.guestsConverted)}
          note="Their games moved to an account"
        />
        <Tile label="Accounts created" value={formatCount(conversion.accountsCreated)} note="All sign ups" />
      </dl>
      <ChartFigure
        id="conversion"
        title="Sign ups"
        note="Guests whose games moved to an account (they signed up or logged in), and every account created. A guest is a cookie, so one person on two devices counts twice."
        range={range}
        rows={conversion.series}
        columns={[
          { label: bucketName[range.bucket], value: (row) => row.bucket },
          { label: "Guests who saved progress", value: (row) => row.guestsConverted, format: "count" },
          { label: "Accounts created", value: (row) => row.accountsCreated, format: "count" },
        ]}
      >
        <BarChart
          summary={summaryOf(
            "Guests who saved progress",
            conversion.series,
            conversion.series.map((row) => row.guestsConverted),
          )}
          rows={seriesOf(conversion.series, (row) => ({ guests: row.guestsConverted }))}
          series={[{ key: "guests", label: "Guests who saved progress", tone: "accent" }]}
        />
      </ChartFigure>
    </>
  );
}

/** @param {{ report: object }} props */
export function Engagement({ report }) {
  const { range, engagement } = report;
  const cells = engagement.hours.flatMap((row) =>
    row.hours.map((matches, hour) => ({
      day: WEEKDAYS[row.weekday - 1],
      hour: `${String(hour).padStart(2, "0")}:00`,
      matches,
    })),
  );
  const busiest = [...cells]
    .filter((cell) => typeof cell.matches === "number")
    .sort((a, b) => b.matches - a.matches)[0];
  const ranked = (rows) =>
    rows.map((row) => ({ label: row.name, value: row.count, text: formatCount(row.count) }));
  return (
    <>
      <ChartFigure
        id="busy-hours"
        title="Busiest hours (India time)"
        note="Matches finished in each hour of each weekday. Hatched cells had 1 to 4 matches."
        range={range}
        rows={cells}
        columns={[
          { label: "Day", value: (row) => row.day },
          { label: "Hour", value: (row) => row.hour },
          { label: "Matches", value: (row) => row.matches, format: "count" },
        ]}
      >
        <Heatmap
          summary={`Matches by weekday and hour in India time. ${busiest && busiest.matches > 0 ? `Busiest: ${busiest.day} ${busiest.hour}, ${formatCount(busiest.matches)} matches.` : "No matches yet."} The same numbers are in the table below.`}
          rows={engagement.hours}
        />
      </ChartFigure>
      <ChartFigure
        id="achievements"
        title="Top achievements unlocked"
        note="Players who unlocked each achievement in this period."
        range={range}
        rows={engagement.achievements}
        columns={[
          { label: "Achievement", value: (row) => row.name },
          { label: "Players", value: (row) => row.count, format: "count" },
        ]}
      >
        <RankBars items={ranked(engagement.achievements)} tone="gold" />
      </ChartFigure>
      <ChartFigure
        id="quests"
        title="Daily quests completed"
        note="Completions of each quest. Quest days are kept for 8 days, so older completions are not counted."
        range={range}
        rows={engagement.quests}
        columns={[
          { label: "Quest", value: (row) => row.name },
          { label: "Completions", value: (row) => row.count, format: "count" },
        ]}
      >
        <RankBars items={ranked(engagement.quests)} tone="xp" />
      </ChartFigure>
      <ChartFigure
        id="leaderboards"
        title="Leaderboard participants"
        note="Accounts on each board. A board tab is worth showing at 25 entries, and a game page's top 5 at 50 (ADR-029)."
        range={range}
        tableOnly
        rows={[
          ...engagement.leaderboards.allTime.map((row) => ({
            board: boardName(row.board),
            period: "All time",
            entries: row.entries,
          })),
          ...engagement.leaderboards.weekly.map((row) => ({
            board: "Overall XP",
            period: row.week,
            entries: row.entries,
          })),
        ]}
        columns={[
          { label: "Board", value: (row) => row.board },
          { label: "Period", value: (row) => row.period },
          { label: "Accounts", value: (row) => row.entries, format: "count" },
        ]}
      />
    </>
  );
}

/** What the console cannot show yet, and the tickets that will add it. */
const COMING_NEXT = Object.freeze([
  ["Time on page and session length", "needs anonymous telemetry with an opt out (CC-173, CC-174, CC-175)"],
  [
    "Funnels: link opened, first move, sign up",
    "needs telemetry events and nightly totals (CC-174, CC-176, CC-220)",
  ],
  ["Dead clicks and rage clicks", "needs click telemetry and its browser checks (CC-174, CC-178)"],
  ["Errors, connection drops and page speed", "needs the owner UX dashboard (CC-177)"],
  ["Liquidity gates and their measured values", "needs the nightly job and flag table (CC-176, CC-228)"],
  ["Circles: active circles and shared goals", "needs circles (CC-214)"],
  ["Bot XP per player per day", "needs characters seated in rooms (CC-138)"],
]);

/** The "Coming next" panel: what needs new tracking before it can be shown. */
export function ComingNext() {
  return (
    <section className={styles.coming} aria-labelledby="coming-next">
      <h2 id="coming-next" className={styles.comingTitle}>
        Coming next
      </h2>
      <p className={styles.comingNote}>
        This console reads only what the site already stores. These need new tracking first.
      </p>
      <ul className={styles.comingList}>
        {COMING_NEXT.map(([what, needs]) => (
          <li key={what}>
            <strong>{what}</strong>: {needs}.
          </li>
        ))}
      </ul>
    </section>
  );
}
