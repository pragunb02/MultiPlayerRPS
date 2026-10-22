import { useId, useState } from "react";
import { useServices } from "../../app/servicesContext.js";
import { NO_TELEMETRY } from "../../lib/telemetry/facade.js";
import { isSwitchedOff, setSwitchedOff } from "../../lib/telemetry/optOut.js";
import styles from "./UsageCountsSwitch.module.css";

const storage = () => window.localStorage;
const browserSaysNo = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";

/**
 * The one switch for anonymous usage counts in this browser (CC-174, ADR-034.3), on the privacy page and in the
 * profile's privacy settings. On by default. With Global Privacy Control or Do Not Track it is off already, and
 * says so. Turning it off stops counting at once and keeps only `cc.telemetry: off` in this browser, which is never
 * sent to us.
 *
 * @param {{ control: string }} props  the switch's stable name, different on each page
 */
export function UsageCountsSwitch({ control }) {
  const telemetry = useServices().telemetry ?? NO_TELEMETRY;
  const hintId = useId();
  const [on, setOn] = useState(() => !isSwitchedOff(storage));
  const blocked = browserSaysNo();

  function change(event) {
    const next = event.target.checked;
    if (setSwitchedOff(storage, !next)) setOn(next);
    telemetry.switched();
  }

  return (
    <div className={styles.switch}>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={on && !blocked}
          disabled={blocked}
          aria-describedby={hintId}
          data-cc-control={control}
          onChange={change}
        />
        Count how I use the site, anonymously
      </label>
      <p id={hintId} className={styles.hint}>
        {blocked
          ? "Your browser asks sites not to track you, so nothing is counted."
          : "No name, id or address. Off keeps one setting in this browser only."}
      </p>
    </div>
  );
}
