import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { useAction } from "../../hooks/useAction.js";
import { deviceName } from "./deviceName.js";
import styles from "./SignedInDevices.module.css";

const CONTROL = "profile.account.sign_out_device";

/** An India day such as "2026-10-21" in words, "21 Oct 2026". The day is a date, so it is read as one in UTC. */
const dayInWords = (day) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** One signed-in device, with Sign out unless it is the one in use. */
function Device({ device, onSignOut }) {
  const name = deviceName(device);
  const lastSeen = dayInWords(device.lastSeenDay);
  const signOut = useAction(() => onSignOut(device), { id: CONTROL });
  return (
    <li className={styles.item}>
      <span className={styles.name}>{name}</span>
      {device.current && <span className={styles.current}>This device</span>}
      <span className={styles.when}>
        Signed in <time dateTime={device.signedInDay}>{dayInWords(device.signedInDay)}</time>. Last seen{" "}
        <time dateTime={device.lastSeenDay}>{lastSeen}</time>.
      </span>
      {!device.current && (
        <Button
          control={CONTROL}
          variant="secondary"
          action={signOut}
          pendingLabel="Signing out…"
          aria-label={`Sign out ${name}, last seen ${lastSeen}`}
        >
          Sign out
        </Button>
      )}
    </li>
  );
}

/**
 * The account's signed-in devices, this one first, with Sign out on each of the others (CC-262, ADR-081). Each
 * shows only a coarse browser and system and two days, never a place. Signing one out keeps the focus in the list:
 * on the next device's button, or the one before it, or on the message when no other device is left.
 *
 * @param {{ devices: ReturnType<typeof import("../../hooks/useDevices.js").useDevices> }} props
 */
export function SignedInDevices({ devices }) {
  const listRef = useRef(null);
  const statusRef = useRef(null);
  const [signedOut, setSignedOut] = useState({ message: "", at: -1 });

  useEffect(() => {
    if (signedOut.at === -1) return;
    const buttons = listRef.current.querySelectorAll(`button[data-cc-control="${CONTROL}"]`);
    (buttons[signedOut.at] ?? buttons[signedOut.at - 1] ?? statusRef.current).focus();
  }, [signedOut]);

  async function signOut(device) {
    const others = devices.devices.filter((one) => !one.current);
    const at = others.findIndex((one) => one.id === device.id);
    await devices.signOut(device.id);
    setSignedOut({ message: `${deviceName(device)} is signed out.`, at });
  }

  if (devices.status === "loading") {
    return <p className={styles.muted}>Loading your devices…</p>;
  }
  if (devices.status === "error") {
    return <p role="alert">Couldn&apos;t load your devices. {devices.error.message}</p>;
  }
  return (
    <>
      <ul ref={listRef} className={styles.list} aria-label="Signed-in devices">
        {devices.devices.map((device) => (
          <Device key={device.id} device={device} onSignOut={signOut} />
        ))}
      </ul>
      {signedOut.message !== "" && (
        <p ref={statusRef} role="status" tabIndex={-1} className={styles.done}>
          {signedOut.message}
        </p>
      )}
    </>
  );
}
