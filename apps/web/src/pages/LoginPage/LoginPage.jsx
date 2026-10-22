import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { paths, safeNext } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { useSaveProgress } from "../../components/SaveProgress/saveProgressContext.js";
import { useAction } from "../../hooks/useAction.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "../authForms.module.css";
import { isSuspendedAnswer } from "./suspendedAnswer.js";
import { SuspendedNotice } from "./SuspendedNotice.jsx";

export function LoginPage() {
  const session = useSession();
  const saveProgress = useSaveProgress();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [form, setForm] = useState({ email: "", password: "" });
  // A suspended account's answer, with what it typed, so it can download its data (CC-334).
  const [paused, setPaused] = useState(undefined);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const login = useAction(
    async () => {
      setPaused(undefined);
      let signedIn;
      try {
        signedIn = await session.login(form);
      } catch (err) {
        if (!isSuspendedAnswer(err)) throw err;
        setPaused({ endsAt: err.details.endsAt, credentials: { ...form } });
        return;
      }
      const { carriedOver } = signedIn;
      // One confirmation, with the account's numbers, when guest games came along (CC-097).
      saveProgress.confirmSaved(carriedOver);
      // Signed in: the redirect below takes over on the next render.
    },
    { id: "auth.login" },
  );

  function submit(event) {
    event.preventDefault();
    login.run();
  }

  // Already signed in (or just signed in): this page has nothing to offer, go where the player was heading.
  if (session.identity?.kind === "user") {
    return <Navigate to={next} replace />;
  }

  return (
    <section className={styles.page}>
      <PageTitle>Log in</PageTitle>
      <h1>Log in</h1>
      {paused !== undefined && <SuspendedNotice endsAt={paused.endsAt} credentials={paused.credentials} />}
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
        <Button control="auth.login" type="submit" size="lg" action={login}>
          Log in
        </Button>
      </form>
      <p className={styles.switch}>
        New here?{" "}
        <Link to={paths.signup(next)} data-cc-control="auth.to_signup">
          Create an account
        </Link>
      </p>
    </section>
  );
}
