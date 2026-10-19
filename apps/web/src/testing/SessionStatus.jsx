import { useSession } from "../hooks/useSession.js";

/**
 * Puts the session's status on the page, hidden, so a test can wait until everything below the session provider
 * has drawn the player (wait with `sessionReady`). Waiting for the socket to connect is too early: the provider
 * connects first and draws the player a moment later, later still on a busy machine (CC-288).
 */
export function SessionStatus() {
  const { status } = useSession();
  return (
    <span data-testid="session-status" hidden>
      {status}
    </span>
  );
}
