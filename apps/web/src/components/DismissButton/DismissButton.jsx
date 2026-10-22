import { Button } from "../Button/Button.jsx";
import styles from "./DismissButton.module.css";

/**
 * A small "×" that closes something optional (a prompt, a toast action). The × is decoration; `label` is what
 * screen readers hear, so it names what closes: "Close: save your progress". It is the shared ghost button in its
 * icon-only form, drawn round (CC-323).
 *
 * @param {{ control: string, label: string, onClick: () => void, className?: string }} props  `control` is its
 *   stable name for tests and telemetry (`data-cc-control`, CC-164)
 */
export function DismissButton({ control, label, onClick, className = "" }) {
  return (
    <Button
      control={control}
      variant="ghost"
      size="sm"
      icon={<span className={styles.cross}>×</span>}
      label={label}
      className={`${styles.dismiss} ${className}`}
      onClick={onClick}
    />
  );
}
