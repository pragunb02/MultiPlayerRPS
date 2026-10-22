import { birthYearChoices } from "@classicade/shared";
import { Field } from "../Field/Field.jsx";
import { AGE_COPY } from "./ageCopy.js";
import styles from "./YearSelect.module.css";

/** The value of the "I'd rather not say" choice, which is also where the picker starts. */
export const YEAR_NOT_SAID = "";

/**
 * A neutral year of birth picker (CC-152). It starts at "I'd rather not say", the choice that shares the least, and
 * lists every year from this year back 100 years with no hint that any year matters. Only the year is asked, never
 * a date. It is the app's select field (CC-323), so it looks like every other field.
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
  const hint = (
    <>
      <span lang="hi-Latn" className={styles.line}>
        {AGE_COPY.hint.hi}
      </span>
      <span lang="en" className={styles.line}>
        {AGE_COPY.hint.en}
      </span>
    </>
  );
  // After an under 13 refusal, the only time the choice is locked, the refusal in Hinglish too.
  const refusal = error && (
    <>
      {locked && (
        <span lang="hi-Latn" className={styles.line}>
          {AGE_COPY.tooYoung.hi}
        </span>
      )}
      <span lang="en" className={styles.line}>
        {error}
      </span>
    </>
  );
  return (
    <Field
      label="Year of birth"
      kind="select"
      hint={hint}
      error={refusal || ""}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={locked}
      data-cc-control={control}
    >
      <option value={YEAR_NOT_SAID}>I&apos;d rather not say</option>
      {birthYearChoices(currentYear).map((year) => (
        <option key={year} value={String(year)}>
          {year}
        </option>
      ))}
    </Field>
  );
}
