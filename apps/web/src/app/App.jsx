import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { MatchProgressProvider } from "../components/Celebrations/MatchProgressProvider.jsx";
import { FriendRequestToasts } from "../components/Friends/FriendRequestToasts.jsx";
import { Layout } from "../components/Layout/Layout.jsx";
import { GamificationToasts } from "../components/GamificationToasts.jsx";
import { ProgressToasts } from "../components/ProgressToasts.jsx";
import { SaveProgressProvider } from "../components/SaveProgress/SaveProgressProvider.jsx";
import { ToastProvider } from "../components/Toast/ToastProvider.jsx";
import { SessionProvider } from "../hooks/SessionProvider.jsx";
import { CONSOLE_ROUTES } from "../pages/AdminPage/consolePages.js";
import { HomePage } from "../pages/HomePage/HomePage.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { LEGACY_ROUTES, paths, ROUTES } from "./paths.js";
import { prefetchOnIntent } from "./routePrefetch.js";
import {
  AdminRoute,
  ChallengePage,
  DailyPuzzlePage,
  FriendLinkPage,
  FriendsPage,
  LeaderboardPage,
  LoginPage,
  NotFoundPage,
  PassAndPlayPage,
  PlayPage,
  preloadRouteFor,
  PrivacyPage,
  ProfilePage,
  PublicProfilePage,
  RoomPage,
  SignupPage,
  TermsPage,
} from "./routePages.js";
import { ServicesProvider } from "./ServicesProvider.jsx";

/**
 * The app, independent of the browser entry point (router and services are passed in), so tests can render it
 * with a memory router and fake clients. Every page but home downloads on demand (`routePages.js`, CC-322).
 *
 * @param {{ services: { api: object, socket: object, sound: object } }} props
 */
export function App({ services }) {
  // A page that downloads on demand starts downloading when a link to it is pointed at, focused or touched.
  useEffect(
    () => prefetchOnIntent({ document, origin: window.location.origin, preload: preloadRouteFor }),
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
                <Routes>
                  <Route element={<Layout />}>
                    <Route index element={<HomePage />} />
                    <Route path={ROUTES.GAME} element={<PlayPage />} />
                    <Route path={ROUTES.ROOM} element={<RoomPage />} />
                    <Route path={ROUTES.PASS_AND_PLAY} element={<PassAndPlayPage />} />
                    <Route path={ROUTES.LOGIN} element={<LoginPage />} />
                    <Route path={ROUTES.SIGNUP} element={<SignupPage />} />
                    <Route path={ROUTES.PROFILE} element={<ProfilePage />} />
                    <Route path={ROUTES.PLAYER} element={<PublicProfilePage />} />
                    <Route path={ROUTES.CHALLENGE} element={<ChallengePage />} />
                    <Route path={ROUTES.FRIENDS} element={<FriendsPage />} />
                    <Route path={ROUTES.FRIEND_LINK} element={<FriendLinkPage />} />
                    <Route path={ROUTES.DAILY} element={<DailyPuzzlePage />} />
                    <Route path={ROUTES.LEADERBOARD} element={<LeaderboardPage />} />
                    <Route
                      path={ROUTES.LEADERBOARDS}
                      element={<Navigate to={paths.leaderboards()} replace />}
                    />
                    <Route path={ROUTES.PRIVACY} element={<PrivacyPage />} />
                    <Route path={ROUTES.TERMS} element={<TermsPage />} />
                    {CONSOLE_ROUTES.map(({ path, view }) => (
                      <Route key={path} path={path} element={<AdminRoute view={view} />} />
                    ))}
                    {/* Old URLs stay valid: each page replaces them with its canonical URL. */}
                    <Route path={LEGACY_ROUTES.GAME} element={<PlayPage />} />
                    <Route path={LEGACY_ROUTES.ROOM} element={<RoomPage />} />
                    <Route path={LEGACY_ROUTES.PROFILE} element={<Navigate to={paths.profile()} replace />} />
                    <Route path={LEGACY_ROUTES.AUTH} element={<Navigate to={paths.login()} replace />} />
                    <Route path="*" element={<NotFoundPage />} />
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
