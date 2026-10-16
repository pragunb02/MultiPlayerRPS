import { Navigate, Route, Routes } from "react-router";
import { Layout } from "../components/Layout/Layout.jsx";
import { ProgressToasts } from "../components/ProgressToasts.jsx";
import { ToastProvider } from "../components/Toast/ToastProvider.jsx";
import { SessionProvider } from "../hooks/SessionProvider.jsx";
import { HomePage } from "../pages/HomePage/HomePage.jsx";
import { LoginPage } from "../pages/LoginPage/LoginPage.jsx";
import { NotFoundPage } from "../pages/NotFoundPage/NotFoundPage.jsx";
import { PlayPage } from "../pages/PlayPage/PlayPage.jsx";
import { ProfilePage } from "../pages/ProfilePage/ProfilePage.jsx";
import { RoomPage } from "../pages/RoomPage/RoomPage.jsx";
import { SignupPage } from "../pages/SignupPage/SignupPage.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { LEGACY_ROUTES, paths, ROUTES } from "./paths.js";
import { ServicesProvider } from "./ServicesProvider.jsx";

/**
 * The app, independent of the browser entry point (router and services are passed in), so tests can render it
 * with a memory router and fake clients.
 *
 * @param {{ services: { api: object, socket: object } }} props
 */
export function App({ services }) {
  return (
    <ErrorBoundary>
      <ServicesProvider services={services}>
        <SessionProvider>
          <ToastProvider>
            <ProgressToasts />
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path={ROUTES.GAME} element={<PlayPage />} />
                <Route path={ROUTES.ROOM} element={<RoomPage />} />
                <Route path={ROUTES.LOGIN} element={<LoginPage />} />
                <Route path={ROUTES.SIGNUP} element={<SignupPage />} />
                <Route path={ROUTES.PROFILE} element={<ProfilePage />} />
                {/* Old URLs stay valid: each page replaces them with its canonical URL. */}
                <Route path={LEGACY_ROUTES.GAME} element={<PlayPage />} />
                <Route path={LEGACY_ROUTES.ROOM} element={<RoomPage />} />
                <Route path={LEGACY_ROUTES.PROFILE} element={<Navigate to={paths.profile()} replace />} />
                <Route path={LEGACY_ROUTES.AUTH} element={<Navigate to={paths.login()} replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </SessionProvider>
      </ServicesProvider>
    </ErrorBoundary>
  );
}
