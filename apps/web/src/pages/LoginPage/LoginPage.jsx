import { useEffect, useState } from "react";
import { ERROR_CODES } from "@classicade/shared";
import { Link, Navigate, useSearchParams } from "react-router";
import { paths, safeNext } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { useSaveProgress } from "../../components/SaveProgress/saveProgressContext.js";
import { useAction } from "../../hooks/useAction.js";
import { useSession } from "../../hooks/useSession.js";
import { useServices } from "../../app/servicesContext.js";
import { NO_TELEMETRY } from "../../lib/telemetry/facade.js";
import { nextKindOf } from "../../lib/telemetry/authForms.js";
import styles from "../authForms.module.css";

export function LoginPage() {
  const session = useSession();
  const saveProgress = useSaveProgress();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const telemetry = useServices().telemetry ?? NO_TELEMETRY;
  const [form, setForm] = useState({ email: "", password: "" });
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  // Set when the email and password didn't match, so the page can offer to play as a guest instead (CL-91).
  const [mismatch, setMismatch] = useState(false);
  const login = useAction(
    async () => {
      setMismatch(false);
      let answer;
      try {
        answer = await session.login(form);
      } catch (err) {
        if (err.code !== ERROR_CODES.UNAUTHORIZED) throw err;
        setMismatch(true);
        // The server says only that the pair is wrong, never which half, so the words don't either.
        throw new Error("That email and password don't match. Check them and try again.", { cause: err });
      }
      const { carriedOver } = answer;
      // One confirmation, with the account's numbers, when guest games came along (CC-097).
      saveProgress.confirmSaved(carriedOver);
      // Signed in: the redirect below takes over on the next render.
    },
    { id: "auth.login" },
  );

  // The top of the login funnel (CC-174): which form, and where next points as a kind, never the path.
  const nextKind = nextKindOf(next);
  useEffect(() => {
    telemetry.track("auth_form_viewed", { form: "login", next_kind: nextKind });
  }, [telemetry, nextKind]);

  function submit(event) {
    event.preventDefault();
    telemetry.track("auth_form_submitted", { form: "login" });
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
      <p className={styles.note}>Log in to keep your XP, streaks and friends on any device.</p>
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
        {mismatch && (
          <p className={styles.note}>
            <Link to={next} data-cc-control="auth.login.play_as_guest">
              Play as a guest instead
            </Link>
          </p>
        )}
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
