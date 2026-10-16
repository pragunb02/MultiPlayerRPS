import { Route, Routes } from "react-router";
import { Layout } from "../components/Layout/Layout.jsx";
import { SessionProvider } from "../hooks/SessionProvider.jsx";
import { HomePage } from "../pages/HomePage/HomePage.jsx";
import { NotFoundPage } from "../pages/NotFoundPage/NotFoundPage.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
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
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </SessionProvider>
      </ServicesProvider>
    </ErrorBoundary>
  );
}
