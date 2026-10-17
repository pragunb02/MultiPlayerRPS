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

// Mirrors the server's rules (models/credentials.js) for instant feedback; the server still decides.
const RULES = {
  username: (v) => (/^[A-Za-z0-9_]{3,20}$/.test(v) ? "" : "3–20 letters, numbers or underscores"),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "" : "Enter a valid email address"),
  password: (v) => (v.length >= 8 && v.length <= 128 && v.trim() !== "" ? "" : "8–128 characters"),
};

export function SignupPage() {
  const session = useSession();
  const saveProgress = useSaveProgress();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [touched, setTouched] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const touch = (field) => () => setTouched((current) => ({ ...current, [field]: true }));
  const errorFor = (field) => fieldErrors[field] ?? (touched[field] ? RULES[field](form[field]) : "");
  const signup = useAction(
    async () => {
      setFieldErrors({});
      try {
        const { carriedOver } = await session.signup(form);
        // One confirmation, with the account's numbers, when guest games came along (CC-097).
        saveProgress.confirmSaved(carriedOver);
        // Signed in: the redirect below takes over on the next render.
      } catch (err) {
        // A problem with one field is shown at that field. Anything else is shown under the button.
        const field = err.details?.field;
        if (!(field && RULES[field])) throw err;
        setFieldErrors({ [field]: err.message });
      }
    },
    { id: "auth.signup" },
  );

  function submit(event) {
    event.preventDefault();
    setTouched({ username: true, email: true, password: true });
    if (Object.keys(RULES).every((field) => RULES[field](form[field]) === "")) {
      signup.run();
    }
  }

  // Already signed in (or just signed in): this page has nothing to offer, go where the player was heading.
  if (session.identity?.kind === "user") {
    return <Navigate to={next} replace />;
  }

  return (
    <section className={styles.page}>
      <PageTitle>Sign up</PageTitle>
      <h1>Create your account</h1>
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field
          label="Username"
          autoComplete="username"
          required
          value={form.username}
          onChange={update("username")}
          onBlur={touch("username")}
          error={errorFor("username")}
          hint="Shown to other players"
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update("email")}
          onBlur={touch("email")}
          error={errorFor("email")}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={update("password")}
          onBlur={touch("password")}
          error={errorFor("password")}
          hint="At least 8 characters"
        />
        {session.identity?.kind === "guest" && (
          <p className={styles.note}>Your guest XP, level and match history will move to your new account.</p>
        )}
        <Button control="auth.signup" type="submit" size="lg" action={signup}>
          Create account
        </Button>
      </form>
      <p className={styles.switch}>
        Already have an account?{" "}
        <Link to={paths.login(next)} data-cc-control="auth.to_login">
          Log in
        </Link>
      </p>
    </section>
  );
}
