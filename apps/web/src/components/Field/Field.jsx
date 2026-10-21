import { useId, useState } from "react";
import { useAction } from "../../hooks/useAction.js";
import { Button } from "../Button/Button.jsx";
import { countText, FIELD_KINDS } from "../looks.js";
import styles from "./Field.module.css";

/**
 * Copies a read-only value with its own button, which answers like every button (CC-164): "Copied" for a moment,
 * or what went wrong under it.
 */
function CopyControl({ id, value, control, describedBy, copyLabel, onCopied, ...input }) {
  const copy = useAction(
    async () => {
      try {
        await navigator.clipboard.writeText(value);
      } catch (cause) {
        // Shown under the button. The browser's own reason means nothing to a player.
        throw new Error("Couldn't copy. Select the text and copy it", { cause });
      }
      onCopied?.();
    },
    { id: control },
  );
  return (
    <div className={styles.copyRow}>
      <input
        id={id}
        className={styles.control}
        readOnly
        value={value}
        aria-describedby={describedBy}
        onFocus={(event) => event.target.select()}
        {...input}
      />
      <Button control={control} variant="secondary" action={copy} doneLabel="Copied">
        {copyLabel}
      </Button>
    </div>
  );
}

/**
 * A labelled form control with an optional hint, error and character count, wired for screen readers
 * (`aria-describedby`, `aria-invalid`). The error may hold a link, such as the way on from an email that can't
 * be used (CC-238).
 *
 * `kind` picks the control (CC-323): `text` (an input of any text type, the default), `select` (its `<option>`s
 * are the children), `textarea`, `date`, and `copy`, a read-only value with a Copy button beside it. With
 * `maxLength` and `showCount` (on by default for a textarea), the count of characters shows under it.
 *
 * @param {{
 *   label: string,
 *   kind?: "text" | "select" | "textarea" | "date" | "copy",
 *   error?: import("react").ReactNode,
 *   hint?: string,
 *   showCount?: boolean,
 *   control?: string,
 *   copyLabel?: string,
 *   onCopied?: () => void,
 *   children?: import("react").ReactNode,
 * } & import("react").InputHTMLAttributes<HTMLInputElement>} props  `control`: the copy button's control name.
 *   `onCopied`: called after a copy, such as to show a toast
 */
export function Field({
  label,
  kind = "text",
  error = "",
  hint = "",
  showCount,
  control = "field.copy",
  copyLabel = "Copy",
  onCopied,
  className = "",
  children,
  ...input
}) {
  if (!FIELD_KINDS.includes(kind)) throw new Error(`Field kind "${kind}" is not one of ${FIELD_KINDS}`);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  const counted = input.maxLength !== undefined && (showCount ?? kind === "textarea");
  const [typed, setTyped] = useState(String(input.value ?? input.defaultValue ?? "").length);
  const length = input.value === undefined ? typed : String(input.value).length;
  const describedBy =
    [hint && hintId, error && errorId, counted && countId].filter(Boolean).join(" ") || undefined;
  const shared = {
    id,
    className: styles.control,
    "aria-invalid": error !== "" || undefined,
    "aria-describedby": describedBy,
  };
  const onChange = (event) => {
    setTyped(event.target.value.length);
    input.onChange?.(event);
  };

  let field;
  if (kind === "select") {
    field = (
      <select {...shared} {...input}>
        {children}
      </select>
    );
  } else if (kind === "textarea") {
    field = <textarea {...shared} {...input} onChange={onChange} />;
  } else if (kind === "copy") {
    field = (
      <CopyControl
        id={id}
        value={input.value}
        control={control}
        describedBy={describedBy}
        copyLabel={copyLabel}
        onCopied={onCopied}
        {...input}
      />
    );
  } else {
    field = <input {...shared} {...input} type={kind === "date" ? "date" : input.type} onChange={onChange} />;
  }

  return (
    <div className={`${styles.field} ${styles[kind]} ${className}`} data-cc-field={kind}>
      <label htmlFor={id}>{label}</label>
      {field}
      {(hint || counted) && (
        <div className={styles.under}>
          {hint && (
            <p id={hintId} className={styles.hint}>
              {hint}
            </p>
          )}
          {counted && (
            <p id={countId} className={`${styles.count} ${length >= input.maxLength ? styles.full : ""}`}>
              {countText(length, input.maxLength)}
            </p>
          )}
        </div>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
