import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { MatchProgressProvider } from "../components/Celebrations/MatchProgressProvider.jsx";
import { FriendRequestToasts } from "../components/Friends/FriendRequestToasts.jsx";
import { Layout } from "../components/Layout/Layout.jsx";
import { GamificationToasts } from "../components/GamificationToasts.jsx";
import { ProgressToasts } from "../components/ProgressToasts.jsx";
import { SaveProgressProvider } from "../components/SaveProgress/SaveProgressProvider.jsx";
import { TimeZoneSync } from "../components/TimeZoneSync.jsx";
import { ToastProvider } from "../components/Toast/ToastProvider.jsx";
import { SessionProvider } from "../hooks/SessionProvider.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { prefetchOnIntent } from "./routePrefetch.js";
import { APP_ROUTES, prefetchRouteFor } from "./routePages.js";
import { ServicesProvider } from "./ServicesProvider.jsx";

/**
 * The app, independent of the browser entry point (router and services are passed in), so tests can render it
 * with a memory router and fake clients. Every page but home downloads on demand (`routePages.js`, CC-322).
 *
 * @param {{ services: { api: object, socket: object, sound: object } }} props
 */
export function App({ services }) {
  // A page that downloads on demand is fetched, as a hint only, when a link to it is pointed at, focused or touched.
  useEffect(
    () => prefetchOnIntent({ document, origin: window.location.origin, prefetch: prefetchRouteFor }),
    [],
  );
  return (
    <ErrorBoundary>
      <ServicesProvider services={services}>
        <SessionProvider>
          <ToastProvider>
            <SaveProgressProvider>
              <MatchProgressProvider>
                <ProgressToasts />
                <GamificationToasts />
                <FriendRequestToasts />
                <TimeZoneSync />
                <Routes>
                  <Route element={<Layout />}>
                    {APP_ROUTES.map(({ path, index, page: Page, props, redirect }) => (
                      <Route
                        key={path ?? "index"}
                        index={index}
                        path={path}
                        element={redirect ? <Navigate to={redirect()} replace /> : <Page {...props} />}
                      />
                    ))}
                  </Route>
                </Routes>
              </MatchProgressProvider>
            </SaveProgressProvider>
          </ToastProvider>
        </SessionProvider>
      </ServicesProvider>
    </ErrorBoundary>
  );
}
