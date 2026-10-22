import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { TELEMETRY_PLAYER_KINDS } from "@classicade/shared";
import { ServicesContext } from "../../app/servicesContext.js";
import { useSession } from "../../hooks/useSession.js";
import { whenIdle } from "../idle.js";
import { NO_TELEMETRY } from "./facade.js";

const kindOf = (identity) => {
  if (identity === undefined) return TELEMETRY_PLAYER_KINDS.VISITOR;
  return identity.kind === "user" ? TELEMETRY_PLAYER_KINDS.ACCOUNT : TELEMETRY_PLAYER_KINDS.GUEST;
};

/** The host, with the flag and the client, in its own file: the first page loads none of it (CC-322). */
const loadTelemetryHost = () => import("./TelemetryHost.jsx");

/**
 * The part of usage counts in the first page (CC-174, CC-322). It tells the facade where the player is and who they
 * are, and counts each page view once it settles on its canonical address, so the first page view and anything else
 * counted early wait in the facade. Once the browser is idle it loads the host, which asks the `telemetry_client`
 * flag and loads the client, and the client takes what the facade held. Renders the host once it is there.
 *
 * @param {{ loadHost?: typeof loadTelemetryHost }} props  `loadHost` is for tests
 */
export function TelemetryStub({ loadHost = loadTelemetryHost }) {
  const services = useContext(ServicesContext);
  const telemetry = services?.telemetry ?? NO_TELEMETRY;
  const location = useLocation();
  const session = useSession();
  const landed = useRef(false);
  // The address last counted as a page view, so a session asked again does not count the same page twice.
  const counted = useRef(undefined);
  const [Host, setHost] = useState(undefined);
  // Who the player is, once the session has answered: kept while it is asked again (a sign in, a sign out).
  const [known, setKnown] = useState(undefined);
  const settled = session.status !== "loading";
  const playerKind = settled ? kindOf(session.identity) : known;
  if (playerKind !== known) setKnown(playerKind);
  const { pathname } = location;

  useLayoutEffect(() => {
    telemetry.setContext({ path: pathname, ...(playerKind !== undefined && { playerKind }) });
  }, [telemetry, pathname, playerKind]);

  // A page view counts once the address settled: a page that replaces its address at once is counted at the new one.
  // It also waits for the session, so a returning guest's landing is not counted as a visitor's.
  useEffect(() => {
    if (playerKind === undefined || counted.current === pathname) return undefined;
    const timer = window.setTimeout(() => {
      counted.current = pathname;
      const isLanding = !landed.current;
      landed.current = true;
      const { entry, via } = telemetry.landing;
      telemetry.track("page_viewed", {
        is_landing: isLanding,
        ...(isLanding && { entry }),
        ...(isLanding && via !== "" && { via }),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [telemetry, pathname, playerKind]);

  // The host loads when the browser is idle once the session has answered, so it hands over every early count
  // with its kind. Its file never reloads the tab, and a failed download is tried once more.
  const ready = playerKind !== undefined;
  useEffect(() => {
    if (!ready) return;
    const attempt = (retries) =>
      telemetry
        .quietly(loadHost)
        .then((module) => setHost(() => module.TelemetryHost))
        .catch(() => {
          if (retries > 0) whenIdle({ window, run: () => attempt(retries - 1) });
        });
    whenIdle({ window, run: () => attempt(1) });
  }, [ready, telemetry, loadHost]);

  return Host === undefined ? null : <Host />;
}
