import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { useSession } from "../../hooks/useSession.js";
import { nextPath } from "../authNavigation.js";
import styles from "../authForms.module.css";

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: "", password: "" });
  const [state, setState] = useState({ busy: false, error: "" });
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      await session.login(form);
      navigate(nextPath(params), { replace: true });
    } catch (err) {
      setState({ busy: false, error: err.message });
    }
  }

  return (
    <section className={styles.page}>
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
        New here? <Link to={`/signup?${params}`}>Create an account</Link>
      </p>
    </section>
  );
}
