import { useId } from "react";
import { Link } from "react-router";
import { useExplanation } from "../../hooks/useExplanation.js";
import { ACTION_PHASES } from "../../hooks/useAction.js";
import { BUTTON_SIZES, BUTTON_VARIANTS } from "../looks.js";
import styles from "./Button.module.css";

/**
 * The words a button shows while its action waits, and the spinner beside them. The label stays in the button
 * underneath, hidden, so the button keeps its width and nothing around it jumps.
 */
function Layers({ action, pendingLabel, doneLabel, children }) {
  const pending = action.waitingShown;
  const done = action.phase === ACTION_PHASES.DONE && !pending && doneLabel !== "";
  const hide = (hidden) => (hidden ? "true" : undefined);
  return (
    <span className={styles.stack}>
      <span className={styles.layer} aria-hidden={hide(pending || done)}>
        {children}
      </span>
      <span className={styles.layer} aria-hidden={hide(!pending)}>
        <span className={styles.spinner} aria-hidden="true" />
        {pendingLabel}
      </span>
      {doneLabel !== "" && (
        <span className={styles.layer} aria-hidden={hide(!done)}>
          <span className={styles.check} aria-hidden="true">
            ✓
          </span>
          {doneLabel}
        </span>
      )}
    </span>
  );
}

/**
 * What went wrong with the last press, under the button, with Retry when trying again can help.
 *
 * @param {{ action: ReturnType<typeof import("../../hooks/useAction.js").useAction>, control: string }} props
 */
function Failure({ action, control }) {
  return (
    <span className={styles.failure} role="alert">
      {action.error.message}
      {action.error.retryable && (
        <button
          type="button"
          className={styles.retry}
          data-cc-control={`${control}.retry`}
          data-sound="click"
          onClick={() => action.retry()}
        >
          Retry
        </button>
      )}
    </span>
  );
}

/** The face of the button: an optional icon, then the label. An icon is decoration, so it is hidden from readers. */
function Face({ icon, children }) {
  if (icon === undefined) return children;
  return (
    <>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {children}
    </>
  );
}

/** The class names of one look, so a link and a button drawn alike share them. */
const looks = ({ variant, size, iconOnly, className }) =>
  [styles.button, styles[variant], styles[size], iconOnly ? styles.iconOnly : "", className]
    .filter(Boolean)
    .join(" ");

/**
 * Checks the props every form shares, so a mistake shows in the first test that renders it.
 *
 * @returns {boolean} whether the button shows only its icon
 */
function checked({ variant, size, icon, label, children }) {
  if (!BUTTON_VARIANTS.includes(variant))
    throw new Error(`Button variant "${variant}" is not one of ${BUTTON_VARIANTS}`);
  if (!BUTTON_SIZES.includes(size)) throw new Error(`Button size "${size}" is not one of ${BUTTON_SIZES}`);
  const iconOnly = icon !== undefined && (children === undefined || children === null || children === "");
  if (iconOnly && !label)
    throw new Error("A button that shows only an icon needs a label, its accessible name");
  return iconOnly;
}

/**
 * The link form: a real link (a router `Link` for a page of the app, an `<a>` for anywhere else) drawn as a
 * button. A link goes somewhere, so it has no waiting state and no reason. Without `to` or `href` there is
 * nowhere to go, and that is a mistake in the caller.
 */
function ButtonLink({
  control,
  to,
  href,
  variant,
  size,
  icon,
  label,
  iconOnly,
  className,
  children,
  ...rest
}) {
  const shared = {
    className: looks({ variant, size, iconOnly, className }),
    "data-cc-control": control,
    "data-cc-variant": variant,
    "aria-label": iconOnly ? label : rest["aria-label"],
    ...rest,
  };
  const face = <Face icon={icon}>{iconOnly ? null : children}</Face>;
  if (to !== undefined) {
    return (
      <Link to={to} {...shared}>
        {face}
      </Link>
    );
  }
  if (href === undefined) throw new Error(`The link button "${control}" needs a to or an href`);
  return (
    <a href={href} {...shared}>
      {face}
    </a>
  );
}

/**
 * The app's button, with the feedback every press gets (CC-164, ADR-038, docs/design/CONTRACT.md):
 *
 * 1. Pressed: the face goes down at once, and the subtle click sound plays (CC-103) unless `data-sound` says
 *    otherwise.
 * 2. Waiting: with an `action` (see useAction) still on its way after 400 ms, a spinner and `pendingLabel` take
 *    the label's place and the button is marked busy. Once shown they stay at least 300 ms, so they never flash.
 * 3. Done: the change the press made is the answer. Where nothing else changes, `doneLabel` shows with a check
 *    for a moment.
 * 4. Disabled with a reason: with a `reason` the button cannot act but stays focusable. The reason shows on
 *    hover and focus, and a press shows and announces it instead of doing nothing.
 * 5. Failed: the reason shows under the button, with Retry when trying again can help.
 *
 * Looks: `primary` for the one main next step of a region, `secondary` and `ghost` for the rest, `danger` only
 * where the player may lose something they made (their data, a game in progress), and `accent`, the primary's
 * look on the hero art. Sizes `sm`, `md` and `lg`. With `as="link"` and a `to` or `href` it is a real link drawn
 * as a button (CC-323). With an `icon` and no text it shows only the icon, and `label` is its accessible name.
 *
 * Every button has a `control` name, written to `data-cc-control`, so tests and telemetry can find it.
 * A press runs `onClick` when given, otherwise the action. A submit button leaves the press to its form.
 *
 * @param {{
 *   control: string,
 *   as?: "button" | "link",
 *   to?: string,
 *   href?: string,
 *   variant?: "primary" | "accent" | "secondary" | "ghost" | "danger",
 *   size?: "sm" | "md" | "lg",
 *   icon?: import("react").ReactNode,
 *   label?: string,
 *   action?: ReturnType<typeof import("../../hooks/useAction.js").useAction>,
 *   reason?: string,
 *   pendingLabel?: string,
 *   doneLabel?: string,
 * } & import("react").ButtonHTMLAttributes<HTMLButtonElement>} props
 *   `reason`: why the button cannot act now, empty when it can. `label`: the accessible name of an icon-only button
 */
export function Button({
  control,
  as = "button",
  to,
  href,
  variant = "primary",
  size = "md",
  icon,
  label = "",
  action,
  reason = "",
  pendingLabel = "Sending…",
  doneLabel = "",
  type = "button",
  onClick,
  children,
  className = "",
  ...rest
}) {
  const tipId = useId();
  const explanation = useExplanation();
  const iconOnly = checked({ variant, size, icon, label, children });
  const blocked = reason !== "";
  const pending = action?.waitingShown === true;

  if (as === "link" && !blocked) {
    return (
      <ButtonLink
        control={control}
        to={to}
        href={href}
        variant={variant}
        size={size}
        icon={icon}
        label={label}
        iconOnly={iconOnly}
        className={className}
        onClick={onClick}
        {...rest}
      >
        {children}
      </ButtonLink>
    );
  }

  function press(event) {
    if (blocked) {
      // A blocked submit button must not send its form.
      event.preventDefault();
      explanation.explain(reason);
      return;
    }
    if (onClick !== undefined) {
      onClick(event);
    } else if (action !== undefined && type !== "submit") {
      action.run();
    }
  }

  const explained = blocked && explanation.reason !== "";
  const face = <Face icon={icon}>{iconOnly ? null : children}</Face>;
  return (
    <span className={styles.control}>
      <button
        type={type}
        className={looks({ variant, size, iconOnly, className })}
        aria-disabled={blocked ? "true" : undefined}
        aria-describedby={blocked ? tipId : undefined}
        aria-busy={pending ? "true" : undefined}
        aria-label={iconOnly ? label : undefined}
        data-cc-control={control}
        data-cc-variant={variant}
        data-sound="click"
        onClick={press}
        {...rest}
      >
        {action === undefined ? (
          face
        ) : (
          <Layers action={action} pendingLabel={pendingLabel} doneLabel={doneLabel}>
            {face}
          </Layers>
        )}
      </button>
      {blocked && (
        <span id={tipId} className={`${styles.tip} ${explained ? styles.shown : ""}`}>
          {reason}
        </span>
      )}
      {blocked && (
        <span className="visually-hidden" role="status">
          {explained && <span key={explanation.count}>{reason}</span>}
        </span>
      )}
      {action?.phase === ACTION_PHASES.FAILED && <Failure action={action} control={control} />}
    </span>
  );
}
