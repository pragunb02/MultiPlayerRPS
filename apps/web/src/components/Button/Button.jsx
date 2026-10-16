import styles from "./Button.module.css";

/**
 * The app's button. It makes the subtle click sound when pressed (CC-103), unless `data-sound` says otherwise.
 *
 * @param {{ variant?: "primary" | "accent" | "secondary" | "ghost", size?: "md" | "lg", busy?: boolean } & import("react").ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  disabled,
  children,
  className = "",
  ...rest
}) {
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-sound="click"
      {...rest}
    >
      {children}
    </button>
  );
}
