import { getAvatar } from "@classicade/shared";
import { Svg } from "../Svg.jsx";
import { AVATAR_ART } from "./avatarArt.js";
import styles from "./avatars.module.css";

/** A head and shoulders, for a player without an avatar and for every hidden profile. Drawn for ClassiCade. */
function Silhouette() {
  return (
    <g className={styles.silhouette}>
      <circle cx="32" cy="25" r="10" />
      <path d="M14 54 C14 42 22 38 32 38 C42 38 50 42 50 54 Z" />
    </g>
  );
}

/** The faint grid of the arcade tile behind every avatar. */
const GRID = "M2 18 H62 M2 32 H62 M2 46 H62 M18 2 V62 M32 2 V62 M46 2 V62";

/**
 * A player's avatar on its arcade tile (CC-034). Any id the catalogue or this build does not know, and no id at all,
 * draws the silhouette, so a page never breaks on what the server sends. Decorative unless given a `title`: the
 * name beside it already says who it is.
 *
 * @param {{ avatar?: string, size?: number, title?: string, className?: string }} props
 */
export function Avatar({ avatar, size = 32, title = "", className = "" }) {
  const art = getAvatar(avatar) === undefined ? undefined : AVATAR_ART[avatar];
  const Glyph = art?.Glyph ?? Silhouette;
  return (
    <Svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      title={title}
      className={`${styles.avatar} ${className}`.trim()}
    >
      <rect
        className={`${styles.tile} ${styles[art?.tone ?? "toneNone"]}`}
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14"
      />
      <path className={styles.grid} d={GRID} />
      <Glyph />
    </Svg>
  );
}
