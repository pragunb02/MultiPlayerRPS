import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { LevelBadge } from "../badges/LevelBadge.jsx";
import art from "../art.module.css";
import styles from "./effects.module.css";

const RAYS = Array.from({ length: 12 }, (_, index) => index * 30);

/**
 * Level-up: golden rays burst out behind the new level badge, which pops in. Visual only (the toast says
 * "Level up! …"), and absent under reduced motion.
 *
 * @param {{ level: number }} props
 */
export function LevelUpBurst({ level }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) {
    return null;
  }
  return (
    <div className={`${styles.overlay} ${styles.burst}`} aria-hidden="true" data-effect="level-up">
      <div className={styles.burstStage}>
        <svg className={styles.rays} viewBox="-100 -100 200 200" focusable="false" aria-hidden="true">
          {RAYS.map((angle) => (
            <path
              key={angle}
              d="M-6 -30 L0 -98 L6 -30 Z"
              transform={`rotate(${angle})`}
              className={art.fCurrent}
            />
          ))}
        </svg>
        <div className={styles.burstBadge}>
          <LevelBadge level={level} size="lg" decorative pop />
          <span className={styles.burstLabel}>LEVEL UP</span>
        </div>
      </div>
    </div>
  );
}
