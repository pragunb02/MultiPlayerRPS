import { useEffect, useState } from "react";
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
  const login = useAction(
    async () => {
      const { carriedOver } = await session.login(form);
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
