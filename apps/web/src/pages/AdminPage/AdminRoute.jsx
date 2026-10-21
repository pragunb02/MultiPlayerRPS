import { Suspense } from "react";
import { Skeleton } from "../../components/States/States.jsx";
import { lazyBoard } from "../../games/lazyBoard.js";
import { ADMIN_ACCESS, useAdminAccess } from "../../hooks/useAdminAccess.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { CONSOLE_VIEWS } from "./consolePages.js";

// Downloaded only when an admin opens the console, so nobody else ever loads its code.
const AdminPage = lazyBoard(() => import("./AdminPage.jsx"), "AdminPage");
const FeedbackInbox = lazyBoard(() => import("./FeedbackInbox.jsx"), "FeedbackInbox");
const AgeCorrections = lazyBoard(() => import("./AgeCorrections.jsx"), "AgeCorrections");
const FlagsPanel = lazyBoard(() => import("./FlagsPanel.jsx"), "FlagsPanel");
const DesignPage = lazyBoard(() => import("./DesignPage.jsx"), "DesignPage");
const PAGES = Object.freeze({
  [CONSOLE_VIEWS.TOTALS]: AdminPage,
  [CONSOLE_VIEWS.FEEDBACK]: FeedbackInbox,
  [CONSOLE_VIEWS.AGES]: AgeCorrections,
  [CONSOLE_VIEWS.FLAGS]: FlagsPanel,
  [CONSOLE_VIEWS.DESIGN]: DesignPage,
});

// The shape of a console page while its code or the access check comes, so the page does not jump when it shows.
const Waiting = () => (
  <div aria-live="polite">
    <Skeleton label="Loading the owner console" shape="block" />
  </div>
);

/**
 * The owner console's address (CC-233). For anyone but an admin it is the ordinary "not found" page, the same
 * as the server's 404, so the console's existence is not revealed. The server checks again on every request.
 *
 * @param {{ view: string }} props  a CONSOLE_VIEWS value: the totals and their sections, the feedback inbox (CC-290)
 *   the year of birth corrections (CC-152), the flags (CC-312) or the design contract (CC-314)
 */
export function AdminRoute({ view }) {
  const Page = PAGES[view];
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
