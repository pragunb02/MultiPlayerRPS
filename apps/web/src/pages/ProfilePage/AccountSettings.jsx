import { useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "./AccountSettings.module.css";

const NO_PASSWORDS = Object.freeze({ currentPassword: "", newPassword: "" });
const PASSWORD_FIELDS = Object.freeze(["currentPassword", "newPassword"]);

/**
 * Change password and "sign out other devices" for a signed-in player (CC-116). Both keep this browser signed in
 * and sign out every other one, and each says so when it is done. A refusal of one password box is shown at that
 * box. Anything else is shown under the button, as every button does (CC-164).
 */
export function AccountSettings() {
  const session = useSession();
  const [passwords, setPasswords] = useState(NO_PASSWORDS);
  const [fieldErrors, setFieldErrors] = useState({});
  const [done, setDone] = useState({ password: false, others: false });
  const update = (field) => (event) =>
    setPasswords((current) => ({ ...current, [field]: event.target.value }));

  const changePassword = useAction(
    async () => {
      setFieldErrors({});
      setDone((current) => ({ ...current, password: false }));
      try {
        await session.changePassword(passwords);
      } catch (err) {
        const field = err.details?.field;
        if (!PASSWORD_FIELDS.includes(field)) throw err;
        setFieldErrors({ [field]: err.message });
        return;
      }
      setPasswords(NO_PASSWORDS);
      setDone((current) => ({ ...current, password: true }));
    },
    { id: "profile.account.password" },
  );

  const signOutOthers = useAction(
    async () => {
      setDone((current) => ({ ...current, others: false }));
      await session.signOutOtherDevices();
      setDone((current) => ({ ...current, others: true }));
    },
    { id: "profile.account.sign_out_others" },
  );

  function submit(event) {
    event.preventDefault();
    changePassword.run();
  }

  return (
    <section className={styles.account} aria-labelledby="account-settings">
      <h2 id="account-settings">Account</h2>
      <form className={styles.part} onSubmit={submit} noValidate aria-labelledby="change-password">
        <h3 id="change-password">Change password</h3>
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={passwords.currentPassword}
          onChange={update("currentPassword")}
          error={fieldErrors.currentPassword ?? ""}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="8 to 128 characters"
          value={passwords.newPassword}
          onChange={update("newPassword")}
          error={fieldErrors.newPassword ?? ""}
        />
        {done.password && (
          <p role="status" className={styles.done}>
            Password changed. Your other devices are signed out.
          </p>
        )}
        <Button control="profile.account.password" type="submit" action={changePassword}>
          Change password
        </Button>
      </form>
      <div className={styles.part}>
        <h3>Devices</h3>
        <p className={styles.muted}>
          Signed in on a computer you don't use any more? Sign out everywhere else. This device stays signed
          in.
        </p>
        {done.others && (
          <p role="status" className={styles.done}>
            Your other devices are signed out.
          </p>
        )}
        <Button control="profile.account.sign_out_others" variant="secondary" action={signOutOthers}>
          Sign out other devices
        </Button>
      </div>
    </section>
  );
}
