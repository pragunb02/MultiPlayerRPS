import { useSession } from "../../hooks/useSession.js";

/**
 * The arcade cabinet of the waking up screen. The same drawing is in index.html, where it shows before the app
 * runs, and both use the global classes of styles/wakingUp.css (CC-232). A test keeps the two the same.
 */
export function WakingUpCabinet() {
  return (
    <div className="wake-cabinet" aria-hidden="true">
      <div className="wake-marquee">
        <span className="wake-bulb" />
        <span className="wake-bulb" />
        <span className="wake-bulb" />
        <span className="wake-bulb" />
        <span className="wake-bulb" />
      </div>
      <div className="wake-screen">
        <div className="wake-picture">
          <span className="wake-coin">Insert coin</span>
        </div>
      </div>
      <div className="wake-panel">
        <span className="wake-stick" />
        <span className="wake-button" />
        <span className="wake-button" />
      </div>
    </div>
  );
}

/**
 * While the server has not yet said who the player is, tells them why they wait. The usual reason for a slow
 * answer is a free server that is still waking up (ADR-005). The styles keep it hidden for a short delay, so a
 * fast answer never flashes it. It goes as soon as the answer arrives, whatever the answer is.
 */
export function WakingUp() {
  const session = useSession();
  if (session.status !== "loading") return null;
  return (
    <div className="wake wake--inline" role="status" data-wake="app">
      <WakingUpCabinet />
      <p className="wake-title">Waking up the arcade…</p>
      <p className="wake-detail">Free servers take a moment to wake up.</p>
      <p className="wake-later">
        Still waking up. This can take up to a minute, and the page carries on by itself.
      </p>
    </div>
  );
}
