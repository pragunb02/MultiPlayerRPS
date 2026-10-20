import { useId, useState } from "react";
import { FLAG_ROLLOUT, SITE_NAME } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useAdminFlags } from "../../hooks/useAdminFlags.js";
import { useFlag } from "../../hooks/useFlag.js";
import { isNotFound, isRetryable } from "../../lib/errors.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
import { formatCount } from "./format.js";
import { AUDIENCE_TEXT, rolloutText } from "./flagText.js";
import consoleStyles from "./AdminPage.module.css";
import styles from "./FlagsPanel.module.css";

const SHARE = "share";
const kindOf = (rollout) => (typeof rollout === "number" ? SHARE : rollout);

/** When the owner last set a rollout, in India time like the rest of the console. */
const setAt = (ms) =>
  new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The form that sets one flag's rollout: off, on, or a whole percentage. A percentage is checked here first, and
 * the server checks it again.
 */
function RolloutForm({ flag, setRollout, clearRollout }) {
  const id = useId();
  const [kind, setKind] = useState(kindOf(flag.rollout));
  const [percent, setPercent] = useState(typeof flag.rollout === "number" ? String(flag.rollout) : "10");
  const [problem, setProblem] = useState("");
  const wanted = () => {
    if (kind !== SHARE) return kind;
    const value = Number(percent);
    return Number.isInteger(value) && value >= 0 && value <= 100 && percent.trim() !== "" ? value : undefined;
  };
  const save = useAction(() => setRollout(flag.name, wanted()), { id: "admin.flags.save" });
  const reset = useAction(() => clearRollout(flag.name), { id: "admin.flags.reset" });

  function submit(event) {
    event.preventDefault();
    if (wanted() === undefined) {
      setProblem("Write a whole number from 0 to 100.");
      return;
    }
    setProblem("");
    save.run();
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label={`Rollout of ${flag.name}`}>
      <label className={consoleStyles.rangeField}>
        Rollout
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          data-cc-control="admin.flags.kind"
        >
          <option value={FLAG_ROLLOUT.OFF}>Off</option>
          <option value={FLAG_ROLLOUT.ON}>On</option>
          <option value={SHARE}>A share of the audience</option>
        </select>
      </label>
      {kind === SHARE && (
        <label className={consoleStyles.rangeField}>
          Percentage
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="100"
            step="1"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            aria-invalid={problem === "" ? undefined : "true"}
            aria-describedby={problem === "" ? undefined : `${id}-problem`}
          />
        </label>
      )}
      <Button control="admin.flags.save" type="submit" action={save} doneLabel="Saved">
        Save
      </Button>
      {flag.override !== undefined && (
        <Button control="admin.flags.reset" variant="ghost" action={reset}>
          Use the rollout in code
        </Button>
      )}
      {problem !== "" && (
        <p id={`${id}-problem`} className={consoleStyles.rangeError} role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/** The counts of both sides, with small groups shown as "fewer than 5". */
function Counts({ flag, days }) {
  const sides = [
    ["on", "Flag on"],
    ["off", "Flag off"],
  ];
  return (
    <table className={styles.counts}>
      <caption>{`Last ${days} days`}</caption>
      <thead>
        <tr>
          <th scope="col">Side</th>
          <th scope="col">Times shown</th>
          <th scope="col">Successes</th>
        </tr>
      </thead>
      <tbody>
        {sides.map(([side, label]) => (
          <tr key={side}>
            <th scope="row">{label}</th>
            <td>{formatCount(flag.counts[side].exposures)}</td>
            <td>{formatCount(flag.counts[side].successes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One flag: what it is, who it is for, its rollouts, its counts and its form. */
function Flag({ flag, days, setRollout, clearRollout }) {
  const titleId = useId();
  return (
    <article className={styles.flag} aria-labelledby={titleId}>
      <header className={styles.flagHeader}>
        <h2 id={titleId} className={styles.name}>
          {flag.name}
        </h2>
        {flag.overdue && <span className={styles.overdue}>Past its removal date</span>}
      </header>
      <p className={styles.description}>{flag.description}</p>
      <dl className={styles.facts}>
        <div>
          <dt>Ticket</dt>
          <dd>{flag.ticket}</dd>
        </div>
        <div>
          <dt>For</dt>
          <dd>{AUDIENCE_TEXT[flag.audience]}</dd>
        </div>
        <div>
          <dt>Remove by</dt>
          <dd>{flag.removeBy}</dd>
        </div>
        <div>
          <dt>In code</dt>
          <dd>{rolloutText(flag.codeRollout)}</dd>
        </div>
        <div>
          <dt>Now</dt>
          <dd>
            {rolloutText(flag.rollout)}
            {flag.override !== undefined && ` (set ${setAt(flag.override.updatedAt)})`}
          </dd>
        </div>
        <div>
          <dt>Success</dt>
          <dd>{flag.success}</dd>
        </div>
      </dl>
      <Counts flag={flag} days={days} />
      <RolloutForm
        key={JSON.stringify(flag.rollout)}
        flag={flag}
        setRollout={setRollout}
        clearRollout={clearRollout}
      />
    </article>
  );
}

/** One override left for a removed flag, with the button that clears it. */
function Orphan({ orphan, clearRollout }) {
  const clear = useAction(() => clearRollout(orphan.name), { id: "admin.flags.clear_orphan" });
  return (
    <li className={styles.orphan}>
      <span className={styles.name}>{orphan.name}</span>
      <span>{`${rolloutText(orphan.rollout)} (set ${setAt(orphan.updatedAt)})`}</span>
      <Button
        control="admin.flags.clear_orphan"
        variant="secondary"
        action={clear}
        aria-label={`Clear ${orphan.name}`}
      >
        Clear
      </Button>
    </li>
  );
}

/**
 * Overrides still stored for flags that were removed from the registry. They do nothing, and clearing them keeps
 * the database tidy and the logs quiet.
 */
function Orphans({ orphans, clearRollout }) {
  return (
    <section className={styles.flag} aria-labelledby="orphans-title">
      <h2 id="orphans-title" className={styles.orphansTitle}>
        Overrides of removed flags
      </h2>
      <p className={styles.description}>
        These flags are no longer in the code, so their overrides do nothing. Clear each one.
      </p>
      <ul className={styles.list}>
        {orphans.map((orphan) => (
          <Orphan key={orphan.name} orphan={orphan} clearRollout={clearRollout} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The flag of this ticket (CC-312), on the page it checks: when it is on for the owner, a line says so, and its
 * button counts the flag's success event.
 */
function FlagCheck() {
  const { api } = useServices();
  const on = useFlag("console_flag_check");
  const works = useAction(() => api.sendFlagSuccess("console_flag_check"), { id: "admin.flags.check" });
  if (!on) return null;
  return (
    <div className={styles.check} role="status">
      <p>The console_flag_check flag is on for you, so a rollout reaches this page.</p>
      <Button control="admin.flags.check" variant="secondary" action={works} doneLabel="Counted">
        It works
      </Button>
    </div>
  );
}

/**
 * The owner console's feature flags (CC-312, ADR-073): each flag from the registry in code, its rollout, and a
 * form to change it without a deploy. Only an admin reaches this page (AdminRoute), and the server checks again on
 * every request.
 */
export function FlagsPanel() {
  const flags = useAdminFlags();
  if (flags.status === "error" && isNotFound(flags.error)) {
    return <NotFoundPage />;
  }
  return (
    <section className={consoleStyles.page} aria-labelledby="flags-title">
      <title>{`Flags · Owner console · ${SITE_NAME}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className={consoleStyles.header}>
        <h1 id="flags-title">Flags</h1>
        <p className={consoleStyles.lede}>
          New features ship behind a flag, off at first. Turn one on for a share of players, watch its counts,
          then turn it on for everyone and remove the flag by its date. Counts are anonymous: no player ids
          are kept.
        </p>
      </header>
      <ConsoleTabs current="flags" />
      <FlagCheck />
      {flags.status === "loading" && (
        <p className={consoleStyles.status} role="status">
          Loading…
        </p>
      )}
      {flags.status === "error" && (
        <div className={consoleStyles.status} role="alert">
          <p>{flags.error.message}</p>
          {isRetryable(flags.error) && (
            <Button control="admin.flags.retry" variant="secondary" onClick={flags.retry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {flags.status === "ready" && (
        <>
          {flags.view.source === "code" && (
            <p className={styles.warning} role="alert">
              The database could not be read for a while, so every flag uses its rollout in code.
            </p>
          )}
          {!flags.view.countsRead && (
            <p className={styles.warning} role="alert">
              The stored counts could not be read. Only counts since the last write are shown.
            </p>
          )}
          <ol className={styles.list}>
            {flags.view.flags.map((flag) => (
              <li key={flag.name}>
                <Flag
                  flag={flag}
                  days={flags.view.days}
                  setRollout={flags.setRollout}
                  clearRollout={flags.clearRollout}
                />
              </li>
            ))}
          </ol>
          {flags.view.orphans.length > 0 && (
            <Orphans orphans={flags.view.orphans} clearRollout={flags.clearRollout} />
          )}
        </>
      )}
    </section>
  );
}
