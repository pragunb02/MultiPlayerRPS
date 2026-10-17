import { useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { useSession } from "../../hooks/useSession.js";
import styles from "./AccountSettings.module.css";

const NO_PASSWORDS = Object.freeze({ currentPassword: "", newPassword: "" });
const IDLE = Object.freeze({ busy: false, error: undefined, done: false });

/** The message for one field when the server named it, and the message for the whole form otherwise. */
const fieldError = (state, field) => (state.error?.details?.field === field ? state.error.message : "");
const formError = (state) =>
  state.error !== undefined && !["currentPassword", "newPassword"].includes(state.error.details?.field)
    ? state.error.message
    : "";

/**
 * Change password and "sign out other devices" for a signed-in player (CC-116). Both keep this browser signed in
 * and sign out every other one, and each says so when it is done.
 */
export function AccountSettings() {
  const session = useSession();
  const [passwords, setPasswords] = useState(NO_PASSWORDS);
  const [changing, setChanging] = useState(IDLE);
  const [signingOut, setSigningOut] = useState(IDLE);
  const update = (field) => (event) =>
    setPasswords((current) => ({ ...current, [field]: event.target.value }));

  async function changePassword(event) {
    event.preventDefault();
    setChanging({ ...IDLE, busy: true });
    try {
      await session.changePassword(passwords);
      setPasswords(NO_PASSWORDS);
      setChanging({ ...IDLE, done: true });
    } catch (error) {
      setChanging({ ...IDLE, error });
    }
  }

  async function signOutOthers() {
    setSigningOut({ ...IDLE, busy: true });
    try {
      await session.signOutOtherDevices();
      setSigningOut({ ...IDLE, done: true });
    } catch (error) {
      setSigningOut({ ...IDLE, error });
    }
  }

  return (
    <section className={styles.account} aria-labelledby="account-settings">
      <h2 id="account-settings">Account</h2>
      <form className={styles.part} onSubmit={changePassword} noValidate aria-labelledby="change-password">
        <h3 id="change-password">Change password</h3>
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={passwords.currentPassword}
          onChange={update("currentPassword")}
          error={fieldError(changing, "currentPassword")}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="8 to 128 characters"
          value={passwords.newPassword}
          onChange={update("newPassword")}
          error={fieldError(changing, "newPassword")}
        />
        {formError(changing) && (
          <p role="alert" className={styles.alert}>
            {formError(changing)}
          </p>
        )}
        {changing.done && (
          <p role="status" className={styles.done}>
            Password changed. Your other devices are signed out.
          </p>
        )}
        <Button type="submit" busy={changing.busy}>
          Change password
        </Button>
      </form>
      <div className={styles.part}>
        <h3>Devices</h3>
        <p className={styles.muted}>
          Signed in on a computer you don't use any more? Sign out everywhere else. This device stays signed
          in.
        </p>
        {signingOut.error && (
          <p role="alert" className={styles.alert}>
            {signingOut.error.message}
          </p>
        )}
        {signingOut.done && (
          <p role="status" className={styles.done}>
            Your other devices are signed out.
          </p>
        )}
        <Button variant="secondary" busy={signingOut.busy} onClick={signOutOthers}>
          Sign out other devices
        </Button>
      </div>
    </section>
  );
}
