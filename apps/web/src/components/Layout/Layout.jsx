import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { paths, returnPathFor } from "../../app/paths.js";
import { Logo } from "../../art/Logo.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useSession } from "../../hooks/useSession.js";
import { Button } from "../Button/Button.jsx";
import { SiteFooter } from "../Footer/SiteFooter.jsx";
import { LevelChip } from "../LevelChip/LevelChip.jsx";
import { useSaveProgress } from "../SaveProgress/saveProgressContext.js";
import { SoundControl } from "../SoundControl/SoundControl.jsx";
import styles from "./Layout.module.css";

/** App shell: header with brand, navigation and who you are; pages render into <Outlet />. */
export function Layout() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const next = returnPathFor(location);
  // "Games" covers the catalog and everything inside a game (lobby, rooms).
  const inGames = location.pathname === paths.home() || location.pathname.startsWith("/games/");
  const identity = session.identity;
  // A guest with XP has something to lose: the same sign-up link, worded as what it does for them (CC-097).
  const save = useSaveProgress();
  const hasProgress = save.guest && (save.progress?.xp ?? 0) > 0;

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
          <Logo />
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
        </nav>
        <div className={styles.player}>
          <SoundControl />
          {identity && <LevelChip key={identity.id} />}
          <div className={styles.identity} aria-live="polite">
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
        </div>
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
