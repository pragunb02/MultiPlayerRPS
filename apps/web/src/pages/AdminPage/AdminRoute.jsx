import { Suspense } from "react";
import { lazyBoard } from "../../games/lazyBoard.js";
import { ADMIN_ACCESS, useAdminAccess } from "../../hooks/useAdminAccess.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";

// Downloaded only when an admin opens the console, so nobody else ever loads its code.
const AdminPage = lazyBoard(() => import("./AdminPage.jsx"), "AdminPage");

const Waiting = () => (
  <p role="status" aria-live="polite">
    Loading…
  </p>
);

/**
 * The owner console's address (CC-233). For anyone but an admin it is the ordinary "not found" page, the same
 * as the server's 404, so the console's existence is not revealed. The server checks again on every request.
 */
export function AdminRoute() {
  const access = useAdminAccess();
  if (access === ADMIN_ACCESS.CHECKING) {
    return <Waiting />;
  }
  if (access === ADMIN_ACCESS.NONE) {
    return <NotFoundPage />;
  }
  return (
    <Suspense fallback={<Waiting />}>
      <AdminPage />
    </Suspense>
  );
}
