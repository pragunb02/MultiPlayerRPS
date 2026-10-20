import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { paths, returnPathFor } from "../../app/paths.js";
import { Logo, LogoMark } from "../../art/Logo.jsx";
import { Svg } from "../../art/Svg.jsx";
import { useAction } from "../../hooks/useAction.js";
import { ADMIN_ACCESS, useAdminAccess } from "../../hooks/useAdminAccess.js";
import { useDisclosureMenu } from "../../hooks/useDisclosureMenu.js";
import { useSession } from "../../hooks/useSession.js";
import { Button } from "../Button/Button.jsx";
import { ConnectionBanner } from "../ConnectionBanner/ConnectionBanner.jsx";
import { FeedbackDialog } from "../Feedback/FeedbackDialog.jsx";
import { FEEDBACK_TEXT } from "../Feedback/feedbackText.js";
import { SiteFooter } from "../Footer/SiteFooter.jsx";
import { LevelChip } from "../LevelChip/LevelChip.jsx";
import { PageAnnouncer } from "../PageAnnouncer/PageAnnouncer.jsx";
import { useSaveProgress } from "../SaveProgress/saveProgressContext.js";
import { SiteRequests } from "../SiteRequests/SiteRequests.jsx";
import { SoundControl } from "../SoundControl/SoundControl.jsx";
import { WakingUp } from "../WakingUp/WakingUp.jsx";
import styles from "./Layout.module.css";

/** Three bars: the menu button's picture. */
function MenuIcon() {
  return (
    <Svg viewBox="0 0 24 24" width={22} height={22} className={styles.menuIcon}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

/** What the live region says about who you are, read out when it changes. Empty without a session. */
function identityAnnouncement(identity) {
  if (identity === undefined) return "";
  return identity.kind === "guest"
    ? `Playing as ${identity.displayName}, a guest.`
    : `Signed in as ${identity.displayName}.`;
}

/**
 * App shell: header with brand, navigation and who you are. Pages render into <Outlet />. Under the header sit the
 * player's own connection (CC-158) and the requests other players sent them from rooms they are not looking at
 * (CC-207), so both reach them on every page. On a phone the header is one row (CC-259): the sound controls, your
 * level and name, Log in and Sign up move into a menu behind one button. On a wider screen the same controls sit in
 * the row and the button is not shown.
 */
export function Layout() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const next = returnPathFor(location);
  // "Games" covers the catalog and everything inside a game (lobby, rooms).
  const inGames = location.pathname === paths.home() || location.pathname.startsWith("/games/");
  const identity = session.identity;
  const adminAccess = useAdminAccess();
  // A guest with XP has something to lose: the same sign-up link, worded as what it does for them (CC-097).
  const save = useSaveProgress();
  const hasProgress = save.guest && (save.progress?.xp ?? 0) > 0;
  const { open: menuOpen, toggle: toggleMenu, close: closeMenu, buttonRef, panelRef } = useDisclosureMenu();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const openFeedback = () => setFeedbackOpen(true);
  // From the phone's menu: the menu closes first and its button takes the focus, so the dialog gives the focus
  // back to a button that is still on screen when it closes (CC-290).
  const openFeedbackFromMenu = () => {
    if (menuOpen) {
      closeMenu();
      buttonRef.current.focus();
    }
    openFeedback();
  };

  const logout = useAction(
    async () => {
      await session.logout();
      navigate(paths.home());
    },
    { id: "header.logout" },
  );

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main" data-cc-control="header.skip">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link
          to={paths.home()}
          className={styles.brand}
          aria-label="ClassiCade home"
          data-cc-control="header.home"
        >
          <Logo className={styles.wordmark} />
          <LogoMark className={styles.mark} />
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <Link to={paths.home()} aria-current={inGames ? "page" : undefined} data-cc-control="header.games">
            Games
          </Link>
          <NavLink to={paths.leaderboards()} data-cc-control="header.leaderboards">
            Leaderboards
          </NavLink>
          {identity && (
            <NavLink to={paths.profile()} data-cc-control="header.profile">
              Profile
            </NavLink>
          )}
          {/* A guest sees it too, and finds there how to save their progress to add friends (CC-052). */}
          {identity && (
            <NavLink to={paths.friends()} data-cc-control="header.friends">
              Friends
            </NavLink>
          )}
          {/* Shown to admins only. Everyone else never sees a sign of the console (CC-233). */}
          {adminAccess === ADMIN_ACCESS.ADMIN && (
            <NavLink to={paths.admin()} data-cc-control="header.admin">
              Console
            </NavLink>
          )}
        </nav>
        <button
          type="button"
          ref={buttonRef}
          className={styles.menuButton}
          aria-label={hasProgress ? "Menu, with Save progress" : "Menu"}
          title={hasProgress ? "Save your progress: sign up from this menu" : undefined}
          aria-expanded={menuOpen}
          aria-controls="header-menu"
          data-cc-control="header.menu"
          onClick={toggleMenu}
        >
          <MenuIcon />
          {/* A guest with XP sees a dot on the button, so the Save progress nudge inside is not missed (CC-097). */}
          {hasProgress && <span className={styles.menuDot} aria-hidden="true" />}
        </button>
        <div id="header-menu" ref={panelRef} className={`${styles.player} ${menuOpen ? styles.open : ""}`}>
          <SoundControl />
          {identity && <LevelChip key={identity.id} />}
          <div className={styles.identity}>
            {identity && (
              <span className={styles.name} title={identity.kind === "guest" ? "Guest" : "Account"}>
                {identity.displayName}
              </span>
            )}
            {session.status !== "loading" && identity?.kind !== "user" && (
              <>
                <Link to={paths.login(next)} data-cc-control="header.login">
                  Log in
                </Link>
                {/* The name starts with the words on screen (label in name) and still says where it goes. */}
                <Link
                  to={paths.signup(next)}
                  className={styles.cta}
                  data-cc-control="header.signup"
                  aria-label={hasProgress ? "Save progress — sign up" : undefined}
                >
                  {hasProgress ? "Save progress" : "Sign up"}
                </Link>
              </>
            )}
            {identity?.kind === "user" && (
              <Button control="header.logout" variant="ghost" action={logout}>
                Log out
              </Button>
            )}
          </div>
          <Button control="header.feedback" variant="ghost" onClick={openFeedbackFromMenu}>
            {FEEDBACK_TEXT.open}
          </Button>
        </div>
      </header>
      {/* Outside the menu, which a phone hides while it is closed: a hidden region is never read out (CC-259). */}
      <p className="visually-hidden" aria-live="polite">
        {identityAnnouncement(identity)}
      </p>
      <ConnectionBanner />
      <main id="main" className={styles.main}>
        <WakingUp />
        <SiteRequests />
        <Outlet />
      </main>
      <PageAnnouncer />
      <SiteFooter onFeedback={openFeedback} />
      {/* Outside the menu, which a phone hides while it is closed, so the footer can open it too. */}
      {/* A new dialog for each player: a draft and its email never pass to whoever uses the phone next. */}
      <FeedbackDialog
        key={identity?.id ?? "visitor"}
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  );
}
