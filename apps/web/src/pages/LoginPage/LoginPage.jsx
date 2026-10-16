import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { paths, safeNext } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { useSaveProgress } from "../../components/SaveProgress/saveProgressContext.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "../authForms.module.css";

export function LoginPage() {
  const session = useSession();
  const saveProgress = useSaveProgress();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [form, setForm] = useState({ email: "", password: "" });
  const [state, setState] = useState({ busy: false, error: "" });
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const { carriedOver } = await session.login(form);
      // One confirmation, with the account's numbers, when guest games came along (CC-097).
      saveProgress.confirmSaved(carriedOver);
      // Signed in: the redirect below takes over on the next render.
    } catch (err) {
      setState({ busy: false, error: err.message });
    }
  }

  // Already signed in (or just signed in): this page has nothing to offer, go where the player was heading.
  if (session.identity?.kind === "user") {
    return <Navigate to={next} replace />;
  }

  return (
    <section className={styles.page}>
      <PageTitle>Log in</PageTitle>
      <h1>Log in</h1>
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update("email")}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={update("password")}
        />
        {session.identity?.kind === "guest" && (
          <p className={styles.note}>Logging in adds this guest's XP and matches to your account.</p>
        )}
        {state.error && (
          <p role="alert" className={styles.alert}>
            {state.error}
          </p>
        )}
        <Button type="submit" size="lg" busy={state.busy}>
          Log in
        </Button>
      </form>
      <p className={styles.switch}>
        New here? <Link to={paths.signup(next)}>Create an account</Link>
      </p>
    </section>
  );
}
