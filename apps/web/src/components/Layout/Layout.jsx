import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { paths, returnPathFor } from "../../app/paths.js";
import { Logo, LogoMark } from "../../art/Logo.jsx";
import { Svg } from "../../art/Svg.jsx";
import { useAction } from "../../hooks/useAction.js";
import { ADMIN_ACCESS, useAdminAccess } from "../../hooks/useAdminAccess.js";
import { useDisclosureMenu } from "../../hooks/useDisclosureMenu.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { useSession } from "../../hooks/useSession.js";
import { ChallengesProvider } from "../Challenges/ChallengesProvider.jsx";
import { ConnectionBanner } from "../ConnectionBanner/ConnectionBanner.jsx";
import { FeedbackDialog } from "../Feedback/FeedbackDialog.jsx";
import { Inbox } from "../Inbox/Inbox.jsx";
import { SiteFooter } from "../Footer/SiteFooter.jsx";
import { LevelChip } from "../LevelChip/LevelChip.jsx";
import { PageAnnouncer } from "../PageAnnouncer/PageAnnouncer.jsx";
import { useSaveProgress } from "../SaveProgress/saveProgressContext.js";
import { InGameProvider } from "../SiteRequests/InGameProvider.jsx";
import { SiteRequests } from "../SiteRequests/SiteRequests.jsx";
import { SoundPopover } from "../SoundControl/SoundControl.jsx";
import { WakingUp } from "../WakingUp/WakingUp.jsx";
import { AccountMenu } from "./AccountMenu.jsx";
import { HEADER_ROW_LINKS, HEADER_WIDE, SECTIONS, sectionOf } from "./headerLayout.js";
import { currentIf, HeaderMenu, PlayLinks } from "./HeaderMenu.jsx";
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
 * (CC-207), so both reach them on every page.
 *
 * The header (CC-324, rebuilt from the October audit) fits every width from 320 to 1440 px without scrolling
 * sideways. From 64rem it is one row: the game links, the inbox, the sound pill, the level and the account menu.
 * Under 64rem it is compact: the brand, the game links (from 40rem), the inbox and a Menu button, with everything
 * else in the menu's groups. Which one shows is read during render (useMediaQuery), so each control is in the page
 * once.
 */
export function Layout() {
  return (
    <ChallengesProvider>
      <InGameProvider>
        <Shell />
      </InGameProvider>
    </ChallengesProvider>
  );
}

/** The header, the page and the footer, inside what the site-wide requests need. */
function Shell() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMediaQuery(HEADER_WIDE);
  const rowLinks = useMediaQuery(HEADER_ROW_LINKS);
  const next = returnPathFor(location);
  const section = sectionOf(location.pathname);
  const identity = session.identity;
  const admin = useAdminAccess() === ADMIN_ACCESS.ADMIN;
  // A guest with XP has something to lose: the same sign-up link, worded as what it does for them (CC-097).
  const save = useSaveProgress();
  const hasProgress = save.guest && (save.progress?.xp ?? 0) > 0;
  const { open: menuOpen, toggle: toggleMenu, close: closeMenu, buttonRef, panelRef } = useDisclosureMenu();
  // A tablet turned to a wide screen has no menu any more: it closes, so nothing listens for its panel.
  useEffect(() => {
    if (wide) closeMenu();
  }, [wide, closeMenu]);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const openFeedback = () => setFeedbackOpen(true);
  // From the menu: the menu closes first and its button takes the focus, so the dialog gives the focus back to a
  // button that is still on screen when it closes (CC-290).
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

  const signedOutLinks = session.status !== "loading" && identity?.kind !== "user" && (
    <>
      <Link to={paths.login(next)} className={styles.login} data-cc-control="header.login">
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
  );

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main" data-cc-control="header.skip">
        Skip to content
      </a>
      <header className={`${styles.header} ${wide ? styles.wide : styles.compact}`}>
        <div className={styles.row}>
          <Link
            to={paths.home()}
            className={styles.brand}
            aria-label="ClassiCade home"
            data-cc-control="header.home"
          >
            {rowLinks ? <Logo className={styles.wordmark} /> : <LogoMark className={styles.mark} />}
          </Link>
          {rowLinks && (
            <nav aria-label="Main" className={styles.nav}>
              <PlayLinks section={section} />
              {wide && admin && (
                <Link
                  to={paths.admin()}
                  aria-current={currentIf(SECTIONS.ADMIN, section)}
                  data-cc-control="header.admin"
                >
                  Console
                </Link>
              )}
            </nav>
          )}
          <div className={styles.end}>
            {identity && <Inbox key={identity.id} />}
            {wide ? (
              <>
                <SoundPopover />
                {identity && <LevelChip key={identity.id} />}
                {identity && (
                  <AccountMenu
                    identity={identity}
                    section={section}
                    logout={logout}
                    onFeedback={openFeedback}
                  />
                )}
                {signedOutLinks}
              </>
            ) : (
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
            )}
          </div>
        </div>
        {!wide && (
          <HeaderMenu
            id="header-menu"
            panelRef={panelRef}
            open={menuOpen}
            withPlay={!rowLinks}
            section={section}
            identity={identity}
            signedOutLinks={signedOutLinks}
            logout={logout}
            admin={admin}
            onFeedback={openFeedbackFromMenu}
          />
        )}
      </header>
      {/* Outside the menu, which is hidden while it is closed: a hidden region is never read out (CC-259). */}
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
