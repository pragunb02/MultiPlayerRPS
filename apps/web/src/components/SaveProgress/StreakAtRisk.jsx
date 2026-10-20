import { Link, useLocation } from "react-router";
import { paths, returnPathFor } from "../../app/paths.js";
import { StreakFlame } from "../../art/effects/StreakFlame.jsx";
import { DismissButton } from "../DismissButton/DismissButton.jsx";
import { useStreakAtRisk } from "./saveProgressContext.js";
import styles from "./StreakAtRisk.module.css";
import { useInterruption } from "../../hooks/useInterruption.js";

/**
 * One line for a guest whose daily streak (two days or more) ends unless they play today (CC-097): play to keep
 * it, sign up so it can never be lost with the guest session. Renders nothing for anyone else.
 */
export function StreakAtRisk() {
  const atRisk = useStreakAtRisk();
  const location = useLocation();
  const interruption = useInterruption("line.streak_at_risk", { open: atRisk !== undefined });
  if (atRisk === undefined) {
    return null;
  }
  return (
    <p className={styles.line} data-cc-surface="line.streak_at_risk">
      <span className={styles.flame} aria-hidden="true">
        <StreakFlame count={atRisk.days} />
      </span>
      <span className={styles.text}>
        Play today to keep your {atRisk.days}-day streak —{" "}
        <Link
          to={paths.signup(returnPathFor(location))}
          data-cc-control="streak.signup"
          onClick={interruption.acted}
        >
          sign up so it's never lost
        </Link>
      </span>
      <DismissButton
        control="streak.dismiss"
        label="Close: streak reminder"
        onClick={() => {
          interruption.dismissed();
          atRisk.dismiss();
        }}
      />
    </p>
  );
}
