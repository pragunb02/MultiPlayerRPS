import { useEffect, useState } from "react";
import { ERROR_CODES, isTooYoungForAccount, TOO_YOUNG_MESSAGE } from "@classicade/shared";
import { Link, Navigate, useSearchParams } from "react-router";
import { paths, safeNext } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { YEAR_NOT_SAID, YearSelect } from "../../components/YearSelect/YearSelect.jsx";
import { useSaveProgress } from "../../components/SaveProgress/saveProgressContext.js";
import { useAction } from "../../hooks/useAction.js";
import { useSession } from "../../hooks/useSession.js";
import { useServices } from "../../app/servicesContext.js";
import { NO_TELEMETRY } from "../../lib/telemetry/facade.js";
import { nextKindOf, ruleOf } from "../../lib/telemetry/authForms.js";
import styles from "../authForms.module.css";

// Mirrors the server's rules (models/credentials.js) for instant feedback; the server still decides.
const RULES = {
  username: (v) => (/^[A-Za-z0-9_]{3,20}$/.test(v) ? "" : "3–20 letters, numbers or underscores"),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "" : "Enter a valid email address"),
  password: (v) => (v.length >= 8 && v.length <= 128 && v.trim() !== "" ? "" : "8–128 characters"),
};

/**
 * The one answer for every email that can't be used, whoever it belongs to, so sign-up never tells who plays here
 * (CC-238). The words are `ACCOUNT_MESSAGES.EMAIL_UNAVAILABLE`, and "log in" is a link that keeps where the player
 * was heading. The email itself never goes into the link. Password reset does not exist yet (CC-033), so a player
 * who forgot theirs is pointed to the Feedback button at the foot of every page (CC-350, CL-92).
 *
 * @param {{ next: string }} props  where to go after logging in
 */
function EmailUnavailable({ next }) {
  return (
    <>
      That email can&apos;t be used. If it&apos;s yours,{" "}
      <Link to={paths.login(next)} data-cc-control="auth.email_unavailable_login">
        log in
      </Link>
      . Forgot your password? Tell us with Feedback and we&apos;ll help.
    </>
  );
}

/** What the server's refusal of one field means, in the form's own words, never the server's (CC-350). */
function fieldWords(field, err, value) {
  if (field === "username" && err.code === ERROR_CODES.CONFLICT)
    return "That username is taken. Try another one.";
  return RULES[field]?.(value) || err.message;
}

/** What the server is sent: the year as a number, or nothing at all when the player would rather not say. */
const credentialsOf = ({ birthYear, ...form }) =>
  birthYear === YEAR_NOT_SAID ? form : { ...form, birthYear: Number(birthYear) };

/** The sign-up form. Field rules are checked as the player types, and the server has the last word. */
export function SignupPage() {
  const session = useSession();
  const saveProgress = useSaveProgress();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const telemetry = useServices().telemetry ?? NO_TELEMETRY;
  const [form, setForm] = useState({ username: "", email: "", password: "", birthYear: "" });
  // Set when the server refused the year (under 13). The choice then stays as it is for this visit (CC-152).
  const [tooYoung, setTooYoung] = useState(false);
  const thisYear = new Date().getFullYear();
  const [touched, setTouched] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const touch = (field) => () => setTouched((current) => ({ ...current, [field]: true }));
  const errorFor = (field) => fieldErrors[field] ?? (touched[field] ? RULES[field](form[field]) : "");
  const signup = useAction(
    async () => {
      setFieldErrors({});
      try {
        const { carriedOver } = await session.signup(credentialsOf(form));
        // One confirmation, with the account's numbers, when guest games came along (CC-097).
        saveProgress.confirmSaved(carriedOver);
        // Signed in: the redirect below takes over on the next render.
      } catch (err) {
        // A problem with one field is shown at that field. Anything else is shown under the button.
        const field = err.details?.field;
        if (!(field && field in form)) throw err;
        const unavailable = field === "email" && err.code === ERROR_CODES.CONFLICT;
        setFieldErrors({
          [field]: unavailable ? <EmailUnavailable next={next} /> : fieldWords(field, err, form[field]),
        });
        if (err.details.reason === "too-young") setTooYoung(true);
      }
    },
    { id: "auth.signup" },
  );

  // The top of the sign-up funnel (CC-174): which form, and where next points as a kind, never the path.
  const nextKind = nextKindOf(next);
  useEffect(() => {
    telemetry.track("auth_form_viewed", { form: "signup", next_kind: nextKind });
  }, [telemetry, nextKind]);

  function submit(event) {
    event.preventDefault();
    setTouched({ username: true, email: true, password: true });
    // Checked here as well as on the server, so a child's year of birth is never sent anywhere (CC-152).
    const year = Number(form.birthYear);
    if (
      form.birthYear !== YEAR_NOT_SAID &&
      isTooYoungForAccount({ birthYear: year, currentYear: thisYear })
    ) {
      setFieldErrors({ birthYear: TOO_YOUNG_MESSAGE });
      setTooYoung(true);
      return;
    }
    const broken = Object.keys(RULES).filter((field) => RULES[field](form[field]) !== "");
    // Which field and rule stopped the form, never what was typed (CC-174).
    broken.forEach((field) =>
      telemetry.track("auth_form_rejected", { form: "signup", field, rule: ruleOf(field, form[field]) }),
    );
    if (broken.length === 0) {
      telemetry.track("auth_form_submitted", { form: "signup" });
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
        <YearSelect
          control="auth.signup.birth_year"
          currentYear={thisYear}
          value={form.birthYear}
          onChange={(birthYear) => setForm((current) => ({ ...current, birthYear }))}
          error={fieldErrors.birthYear ?? ""}
          locked={tooYoung}
        />
        {tooYoung && (
          <p className={styles.note}>
            <Link to={paths.home()} data-cc-control="auth.signup.play_as_guest">
              Play as a guest
            </Link>
          </p>
        )}
        {session.identity?.kind === "guest" && (
          <p className={styles.note}>Your guest XP, level and match history will move to your new account.</p>
        )}
        <Button
          control="auth.signup"
          type="submit"
          size="lg"
          action={signup}
          reason={tooYoung ? "ClassiCade accounts are for people aged 13 and over" : ""}
        >
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
