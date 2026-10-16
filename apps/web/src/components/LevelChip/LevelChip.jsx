import { useEffect, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { LevelBadge } from "../../art/badges/LevelBadge.jsx";
import { useProgress } from "../../hooks/useProgress.js";
import styles from "./LevelChip.module.css";

/**
 * Level and XP, always on screen in the header: being close to the next level is the "one more game" pull
 * (ADR-012). Starts from the player's progress and follows every `progress:updated` push; the bar pulses once
 * when XP comes in. Shows nothing until progress is known (or if it can't be loaded — the profile explains).
 * Mounted per identity (`key`), so a different player never sees someone else's level.
 */
export function LevelChip() {
  const { socket } = useServices();
  const loaded = useProgress();
  const [pushed, setPushed] = useState(undefined);

  useEffect(() => socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, ({ progress }) => setPushed(progress)), [socket]);

  const progress = pushed ?? loaded.progress;
  if (progress === undefined) {
    return null;
  }
  const atTop = progress.xpForNextLevel === 0;
  return (
    <span className={styles.chip}>
      <LevelBadge level={progress.level} size="sm" decorative />
      <span className={styles.level} aria-hidden="true">
        Lv {progress.level}
      </span>
      <progress
        key={progress.xp}
        className={`${styles.bar} ${pushed ? styles.gained : ""}`}
        aria-label={
          atTop
            ? `Level ${progress.level}, the highest level`
            : `Level ${progress.level}: ${progress.xpIntoLevel} of ${progress.xpForNextLevel} XP to the next level`
        }
        max={Math.max(progress.xpForNextLevel, 1)}
        value={atTop ? 1 : progress.xpIntoLevel}
      />
    </span>
  );
}
