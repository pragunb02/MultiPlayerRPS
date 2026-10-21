import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { paths } from "../app/paths.js";
import { whenIdle } from "./channel.js";

// The host's own chunk. A failed load is silent, like any effect's: the page simply has its usual look.
const HostRuntime = lazy(() =>
  import("./HostRuntime.jsx").then(
    (module) => ({ default: module.HostRuntime }),
    () => ({ default: () => null }),
  ),
);

/**
 * The one place effects play (ADR-075, CC-328), mounted once in the layout. Only this loader is on the first route:
 * the host itself (the canvas, the queue, the gates and the event theme, `HostRuntime.jsx`) arrives in its own chunk
 * once the page is idle, long before a game can end. A play before then is dropped, as the gates drop any other.
 *
 * @param {{ effects?: ReadonlyArray<object>, now?: () => number }} props  the registry and the clock, for tests
 */
export function EffectHost(props) {
  const home = useLocation().pathname === paths.home();
  const [idle, setIdle] = useState(false);
  useEffect(() => whenIdle(() => setIdle(true)), []);
  return idle ? (
    <Suspense fallback={null}>
      <HostRuntime home={home} {...props} />
    </Suspense>
  ) : null;
}
