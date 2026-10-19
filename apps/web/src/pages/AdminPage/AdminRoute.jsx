import { Suspense } from "react";
import { lazyBoard } from "../../games/lazyBoard.js";
import { ADMIN_ACCESS, useAdminAccess } from "../../hooks/useAdminAccess.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";

// Downloaded only when an admin opens the console, so nobody else ever loads its code.
const AdminPage = lazyBoard(() => import("./AdminPage.jsx"), "AdminPage");
const FeedbackInbox = lazyBoard(() => import("./FeedbackInbox.jsx"), "FeedbackInbox");
const PAGES = Object.freeze({ totals: AdminPage, feedback: FeedbackInbox });

const Waiting = () => (
  <p role="status" aria-live="polite">
    Loading…
  </p>
);

/**
 * The owner console's address (CC-233). For anyone but an admin it is the ordinary "not found" page, the same
 * as the server's 404, so the console's existence is not revealed. The server checks again on every request.
 *
 * @param {{ page?: "totals" | "feedback" }} props  the totals and their sections, or the feedback inbox (CC-290)
 */
export function AdminRoute({ page = "totals" }) {
  const Page = PAGES[page];
  const access = useAdminAccess();
  if (access === ADMIN_ACCESS.CHECKING) {
    return <Waiting />;
  }
  if (access === ADMIN_ACCESS.NONE) {
    return <NotFoundPage />;
  }
  return (
    <Suspense fallback={<Waiting />}>
      <Page />
    </Suspense>
  );
}
