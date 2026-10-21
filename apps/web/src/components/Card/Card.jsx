import { useId } from "react";
import { Link } from "react-router";
import { ACCENT_TONES, CARD_VARIANTS, NOTICE_TONES } from "../looks.js";
import styles from "./Card.module.css";

const toneOk = (variant, tone) =>
  (variant === "accent" && ACCENT_TONES.includes(tone)) ||
  (variant === "notice" && NOTICE_TONES.includes(tone)) ||
  (variant !== "accent" && variant !== "notice" && tone === undefined);

/**
 * A group of things about one subject: a game tile, a quest, a profile section (CC-323). The app's only card, so
 * every card has the same surface, radius, padding and elevation.
 *
 * 1. `variant`: `surface` rests on the page, `raised` sits higher, `accent` carries a strip of colour along its
 *    top (a game, the brand or gold), and `notice` is a pale status background with its words (`tone`).
 * 2. `interactive`: the card lifts and glows on hover and focus. It holds exactly one link or button, and a
 *    `CardLink` in its header makes the whole card pressable.
 * 3. `selected`: the chosen one of a set, with a border in the brand colour. Say it in words too.
 * 4. `reason`: the card cannot act now. It is dimmed and says why under its content.
 *
 * The parts, in order: `CardMedia` (art that runs to the card's edges), `CardHeader`, `CardBody`, `CardFooter`.
 *
 * @param {{
 *   as?: "article" | "section" | "div" | "li" | "aside" | "form" | "figure",
 *   variant?: "surface" | "raised" | "accent" | "notice",
 *   tone?: string,
 *   interactive?: boolean,
 *   selected?: boolean,
 *   reason?: string,
 *   className?: string,
 *   children: import("react").ReactNode,
 * } & import("react").HTMLAttributes<HTMLElement>} props  `tone`: one of ACCENT_TONES for an accent card, of
 *   NOTICE_TONES for a notice card, and none for the others
 */
export function Card({
  as: Tag = "article",
  variant = "surface",
  tone,
  interactive = false,
  selected = false,
  reason = "",
  className = "",
  children,
  ...rest
}) {
  if (!CARD_VARIANTS.includes(variant))
    throw new Error(`Card variant "${variant}" is not one of ${CARD_VARIANTS}`);
  if (!toneOk(variant, tone)) throw new Error(`Card tone "${tone}" does not fit the ${variant} variant`);
  const blocked = reason !== "";
  const classes = [
    styles.card,
    styles[variant],
    tone === undefined ? "" : styles[`tone-${tone}`],
    interactive && !blocked ? styles.interactive : "",
    selected ? styles.selected : "",
    blocked ? styles.blocked : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag
      className={classes}
      data-cc-card={variant}
      data-selected={selected ? "true" : undefined}
      aria-disabled={blocked ? "true" : undefined}
      {...rest}
    >
      {children}
      {blocked && <p className={styles.reason}>{reason}</p>}
    </Tag>
  );
}

/**
 * Art at the top of a card that runs to its edges, with no box around it. Decoration, so it is hidden from
 * screen readers: the card's heading says what it is.
 *
 * @param {{ children: import("react").ReactNode, className?: string }} props
 */
export function CardMedia({ children, className = "" }) {
  return (
    <div className={`${styles.media} ${className}`} aria-hidden="true">
      {children}
    </div>
  );
}

/**
 * The card's real heading, its one-line description and an optional badge or action beside the title.
 *
 * @param {{
 *   title: import("react").ReactNode,
 *   titleAs?: "h2" | "h3" | "h4",
 *   description?: import("react").ReactNode,
 *   aside?: import("react").ReactNode,
 *   id?: string,
 * }} props  `aside`: a badge or a small action at the end of the title row. `id`: the heading's id, for
 *   `aria-labelledby` on the card
 */
export function CardHeader({ title, titleAs: Heading = "h3", description, aside, id }) {
  const fallback = useId();
  return (
    // A div, not a header: a header outside an article or section is the page's banner landmark (a card as a li).
    <div className={styles.header}>
      <div className={styles.titleRow}>
        <Heading id={id ?? fallback} className={styles.title}>
          {title}
        </Heading>
        {aside !== undefined && <div className={styles.aside}>{aside}</div>}
      </div>
      {description !== undefined && <p className={styles.description}>{description}</p>}
    </div>
  );
}

/**
 * The one link of an interactive card, inside its title. It stretches over the whole card, so a press anywhere on
 * the card follows it, and there is still only one thing to Tab to.
 *
 * @param {{ to: string, control: string, children: import("react").ReactNode }} props
 */
export function CardLink({ to, control, children }) {
  return (
    <Link to={to} className={styles.link} data-cc-control={control}>
      {children}
    </Link>
  );
}

/**
 * The card's content.
 *
 * @param {{ children: import("react").ReactNode, className?: string }} props
 */
export function CardBody({ children, className = "" }) {
  return <div className={`${styles.body} ${className}`}>{children}</div>;
}

/**
 * The card's actions or small print, at its foot. At most one primary button here.
 *
 * @param {{ children: import("react").ReactNode, className?: string }} props
 */
export function CardFooter({ children, className = "" }) {
  // A div, not a footer: a footer outside an article or section is the page's contentinfo landmark.
  return <div className={`${styles.footer} ${className}`}>{children}</div>;
}
