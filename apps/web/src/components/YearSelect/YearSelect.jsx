import { useId } from "react";
import { birthYearChoices } from "@classicade/shared";
import styles from "./YearSelect.module.css";

/** The value of the "I'd rather not say" choice, which is also where the picker starts. */
export const YEAR_NOT_SAID = "";

/**
 * A neutral year of birth picker (CC-152). It starts at "I'd rather not say", the choice that shares the least, and
 * lists every year from this year back 100 years with no hint that any year matters. Only the year is asked, never
 * a date.
 *
 * @param {{
 *   currentYear: number,
 *   value: string,
 *   onChange: (value: string) => void,
 *   error?: string,
 *   locked?: boolean,
 *   control: string,
 * }} props  `value` is `YEAR_NOT_SAID` or a year as text. `locked` keeps the choice as it is after a refusal, so a
 *   different year cannot be sent again in the same visit
 */
export function YearSelect({ currentYear, value, onChange, error = "", locked = false, control }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>Year of birth</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={locked}
        aria-invalid={error !== "" || undefined}
        aria-describedby={[hintId, error && errorId].filter(Boolean).join(" ")}
        data-cc-control={control}
      >
        <option value={YEAR_NOT_SAID}>I&apos;d rather not say</option>
        {birthYearChoices(currentYear).map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </select>
      <p id={hintId} className={styles.hint}>
        Optional. Only the year is kept.
      </p>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
