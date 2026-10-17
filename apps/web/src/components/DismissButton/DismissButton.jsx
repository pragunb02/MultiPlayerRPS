import styles from "./DismissButton.module.css";

/**
 * A small "×" that closes something optional (a prompt, a toast action). The × is decoration; `label` is what
 * screen readers hear, so it names what closes: "Close: save your progress".
 *
 * @param {{ label: string, onClick: () => void, className?: string }} props
 */
export function DismissButton({ label, onClick, className = "" }) {
  return (
    <button type="button" className={`${styles.dismiss} ${className}`} aria-label={label} onClick={onClick}>
      <span aria-hidden="true">×</span>
    </button>
  );
}
