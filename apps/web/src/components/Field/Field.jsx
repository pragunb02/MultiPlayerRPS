import { useId } from "react";
import styles from "./Field.module.css";

/**
 * A labelled form input with an optional hint and error, wired for screen readers
 * (`aria-describedby`, `aria-invalid`).
 *
 * @param {{ label: string, error?: string, hint?: string } & import("react").InputHTMLAttributes<HTMLInputElement>} props
 */
export function Field({ label, error = "", hint = "", ...input }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error !== "" || undefined} aria-describedby={describedBy} {...input} />
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
