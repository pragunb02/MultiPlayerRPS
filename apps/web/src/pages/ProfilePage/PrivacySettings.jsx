import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { isTooYoungForAccount, TOO_YOUNG_MESSAGE } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { AGE_COPY } from "../../components/YearSelect/ageCopy.js";
import { YEAR_NOT_SAID, YearSelect } from "../../components/YearSelect/YearSelect.jsx";
import { useAccount } from "../../hooks/useAccount.js";
import { useAction } from "../../hooks/useAction.js";
import { useSafety } from "../../hooks/useSafety.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./AccountSettings.module.css";

/** Runs `work`, and shows a refusal of one field at that field instead of under the button. */
async function withFieldError(work, field, setError) {
  setError("");
  try {
    return await work();
  } catch (err) {
    if (err.details?.field !== field) throw err;
    setError(err.message);
    return undefined;
  }
}

/**
 * The year of birth, which an account without one can set once (CC-152). A year once set is shown and stays.
 *
 * @param {{ account: ReturnType<typeof useAccount> }} props
 */
function BirthYear({ account }) {
  const { safety, reload } = useSafety();
  const [year, setYear] = useState(YEAR_NOT_SAID);
  const [error, setError] = useState("");
  const [tooYoung, setTooYoung] = useState(false);
  const save = useAction(
    () => {
      // Checked here first, so a child's year of birth is never sent anywhere (CC-152).
      if (isTooYoungForAccount({ birthYear: Number(year), currentYear: new Date().getFullYear() })) {
        setError(TOO_YOUNG_MESSAGE);
        setTooYoung(true);
        return undefined;
      }
      return withFieldError(
        async () => {
          try {
            await account.setBirthYear(Number(year));
            await reload();
          } catch (err) {
            if (err.details?.reason === "too-young") setTooYoung(true);
            throw err;
          }
        },
        "birthYear",
        setError,
      );
    },
    { id: "profile.privacy.birth_year" },
  );
  if (account.status === "loading") return <p>Loading…</p>;
  if (account.status === "error")
    return <p role="alert">Couldn&apos;t load your account. {account.error.message}</p>;
  const { birthYear } = account.account;
  return (
    <div className={styles.part}>
      <h3>Year of birth</h3>
      {birthYear === undefined ? (
        <>
          <YearSelect
            control="profile.privacy.birth_year.select"
            currentYear={new Date().getFullYear()}
            value={year}
            onChange={setYear}
            error={error}
            locked={tooYoung}
          />
          <Button
            control="profile.privacy.birth_year"
            variant="secondary"
            action={save}
            reason={year === YEAR_NOT_SAID || tooYoung ? "Choose a year first" : ""}
          >
            Save year
          </Button>
        </>
      ) : (
        <p className={styles.muted}>
          <span lang="hi-Latn" className={styles.line}>
            {birthYear}. {AGE_COPY.setOnce.hi}
          </span>
          <span lang="en" className={styles.line}>
            {birthYear}. {AGE_COPY.setOnce.en} (see the{" "}
            <Link to={paths.privacy()} data-cc-control="profile.privacy.policy">
              privacy policy
            </Link>
            ).
          </span>
        </p>
      )}
      {/* Read from the age policy, never worked out here (CC-152). */}
      {safety.boardName === "hidden" && (
        <p className={styles.muted}>
          <span lang="hi-Latn" className={styles.line}>
            {AGE_COPY.hiddenOnBoards.hi}
          </span>
          <span lang="en" className={styles.line}>
            {AGE_COPY.hiddenOnBoards.en}
          </span>
        </p>
      )}
    </div>
  );
}

/** A copy of everything ClassiCade holds about the account, as a JSON file, after the password again (CC-035). */
function DataExport() {
  const { api, download } = useServices();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const exportData = useAction(
    async () => {
      setDone(false);
      const data = await withFieldError(() => api.exportData(password), "password", setError);
      if (data === undefined) return;
      download.saveJson({ filename: `classicade-data-${data.exportedAt.slice(0, 10)}.json`, data });
      setPassword("");
      setDone(true);
    },
    { id: "profile.privacy.export" },
  );
  function submit(event) {
    event.preventDefault();
    exportData.run();
  }
  return (
    <form className={styles.part} onSubmit={submit} noValidate aria-labelledby="export-data">
      <h3 id="export-data">Download your data</h3>
      <p className={styles.muted}>
        A file with your account, games, progress, achievements, quests, leaderboard places and the players
        you blocked. Other players appear by their display name only.
      </p>
      <Field
        label="Password for the download"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={error}
      />
      {done && (
        <p role="status" className={styles.done}>
          Your data is downloaded.
        </p>
      )}
      <Button control="profile.privacy.export" type="submit" variant="secondary" action={exportData}>
        Download my data
      </Button>
    </form>
  );
}

/**
 * Deleting the account, after the password and a confirmation that says what goes and what stays (CC-035).
 * Afterwards this browser is signed out and the profile says the account is gone.
 */
function DeleteAccount() {
  const session = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const remove = useAction(
    async () => {
      const deleted = await withFieldError(
        async () => {
          await session.deleteAccount(password);
          return true;
        },
        "password",
        setError,
      );
      setConfirming(false);
      if (deleted) navigate(paths.profile(), { replace: true, state: { accountDeleted: true } });
    },
    { id: "profile.privacy.delete" },
  );
  function submit(event) {
    event.preventDefault();
    setConfirming(true);
  }
  return (
    <form className={styles.part} onSubmit={submit} noValidate aria-labelledby="delete-account">
      <h3 id="delete-account">Delete your account</h3>
      <p className={styles.muted}>
        This deletes your account, progress, achievements, quests and leaderboard places at once, and signs
        you out everywhere. It cannot be undone.
      </p>
      <Field
        label="Password for deleting"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={error}
      />
      <Button
        control="profile.privacy.delete.open"
        type="submit"
        variant="secondary"
        reason={password === "" ? "Type your password first" : ""}
      >
        Delete my account
      </Button>
      <Modal
        open={confirming}
        title="Delete your account?"
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button
              control="profile.privacy.delete.cancel"
              variant="secondary"
              onClick={() => setConfirming(false)}
            >
              Keep my account
            </Button>
            <Button
              control="profile.privacy.delete"
              variant="accent"
              action={remove}
              pendingLabel="Deleting…"
            >
              Delete for good
            </Button>
          </>
        }
      >
        <ul className={styles.list}>
          <li>Your account, username, email and password go now.</li>
          <li>Your progress, achievements, quests and leaderboard places go now.</li>
          <li>
            Games you played against other people stay in their history, with your name replaced by
            &quot;Deleted player&quot;.
          </li>
          <li>A game you are in now ends, and your opponent wins.</li>
          <li>Copies in our encrypted backups are gone within 30 days.</li>
        </ul>
      </Modal>
    </form>
  );
}

/** Year of birth, the data download and deleting the account, for a signed-in player (CC-035, CC-152). */
export function PrivacySettings() {
  const account = useAccount();
  return (
    <section className={styles.account} aria-labelledby="privacy-settings">
      <h2 id="privacy-settings">Your data and privacy</h2>
      <BirthYear account={account} />
      <DataExport />
      <DeleteAccount />
    </section>
  );
}
