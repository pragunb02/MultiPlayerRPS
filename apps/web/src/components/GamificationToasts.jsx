import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { AchievementIcon } from "../art/achievements/AchievementIcon.jsx";
import { Confetti } from "../art/effects/Confetti.jsx";
import { XpPop } from "../art/effects/XpPop.jsx";
import styles from "./GamificationToasts.module.css";
import { useToast } from "./Toast/toastContext.js";

const SWEEP_SUFFIX = ":sweep";
const TIERS = new Set(["bronze", "silver", "gold", "platinum"]);
/** How long a celebration stays mounted: its animation (--duration-celebrate) plus a little slack. */
export const CELEBRATION_MS = 1_500;

/**
 * Celebrates what the server pushes (CC-054, CC-089): "Achievement unlocked: Hat Trick" for each new unlock, and
 * "Quest complete! +40 XP" when a quest's bonus is awarded (once each — the server sends quest XP exactly once).
 * The toasts say it in words, with the achievement's medal or a quest scroll beside them; confetti (an unlock) and
 * the rising "+N XP" (a quest) show it, and are skipped under reduced motion (CC-087).
 */
export function GamificationToasts() {
  const { socket } = useServices();
  const toast = useToast();
  const [celebration, setCelebration] = useState(undefined);
  const next = useRef(0);

  useEffect(() => {
    const offUnlocks = socket.on(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, ({ achievements }) => {
      achievements.forEach((achievement) =>
        toast.show(`Achievement unlocked: ${achievement.name}`, {
          tone: "success",
          art: (
            <AchievementIcon
              name={achievement.icon}
              tier={TIERS.has(achievement.tier) ? achievement.tier : "bronze"}
            />
          ),
        }),
      );
      if (achievements.length > 0) {
        setCelebration({ id: ++next.current, kind: "unlock" });
      }
    });
    const offQuestXp = socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, ({ source, key, xpGained }) => {
      if (source !== "quest") return;
      toast.show(
        key.endsWith(SWEEP_SUFFIX) ? `Daily sweep! +${xpGained} XP` : `Quest complete! +${xpGained} XP`,
        { tone: "success", art: <AchievementIcon name="scroll" tier="gold" /> },
      );
      setCelebration({ id: ++next.current, kind: "quest", xp: xpGained });
    });
    return () => {
      offUnlocks();
      offQuestXp();
    };
  }, [socket, toast]);

  useEffect(() => {
    if (celebration === undefined) {
      return undefined;
    }
    const timer = setTimeout(() => setCelebration(undefined), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [celebration]);

  if (celebration === undefined) {
    return null;
  }
  return createPortal(
    celebration.kind === "unlock" ? (
      <Confetti key={celebration.id} />
    ) : (
      <div key={celebration.id} className={styles.xp} aria-hidden="true">
        <XpPop xp={celebration.xp} />
      </div>
    ),
    document.body,
  );
}
