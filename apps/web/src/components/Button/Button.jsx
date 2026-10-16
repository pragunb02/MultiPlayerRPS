import styles from "./Button.module.css";

/**
 * @param {{ variant?: "primary" | "secondary" | "ghost", size?: "md" | "lg", busy?: boolean } & import("react").ButtonHTMLAttributes<HTMLButtonElement>} props
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
      {...rest}
    >
      {children}
    </button>
  );
}
