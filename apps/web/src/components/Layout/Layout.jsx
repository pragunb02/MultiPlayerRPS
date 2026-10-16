import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { paths, returnPathFor } from "../../app/paths.js";
import { useSession } from "../../hooks/useSession.js";
import { Button } from "../Button/Button.jsx";
import { useToast } from "../Toast/toastContext.js";
import styles from "./Layout.module.css";

/** App shell: header with brand, navigation and who you are; pages render into <Outlet />. */
export function Layout() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const next = returnPathFor(location);
  // "Games" covers the catalog and everything inside a game (lobby, rooms).
  const inGames = location.pathname === paths.home() || location.pathname.startsWith("/games/");
  const identity = session.identity;

  async function logout() {
    try {
      await session.logout();
      navigate(paths.home());
    } catch (err) {
      toast.show(err.message, { tone: "danger" });
    }
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to={paths.home()} className={styles.brand} aria-label="ClassiCade home">
          ClassiCade
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <Link to={paths.home()} aria-current={inGames ? "page" : undefined}>
            Games
          </Link>
          <NavLink to={paths.leaderboards()}>Leaderboards</NavLink>
          {identity && <NavLink to={paths.profile()}>Profile</NavLink>}
        </nav>
        <div className={styles.identity} aria-live="polite">
          {identity && (
            <span title={identity.kind === "guest" ? "Guest" : "Account"}>{identity.displayName}</span>
          )}
          {session.status !== "loading" && identity?.kind !== "user" && (
            <>
              <Link to={paths.login(next)}>Log in</Link>
              <Link to={paths.signup(next)} className={styles.cta}>
                Sign up
              </Link>
            </>
          )}
          {identity?.kind === "user" && (
            <Button variant="ghost" onClick={logout}>
              Log out
            </Button>
          )}
        </div>
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>Play the classics with anyone, anywhere.</footer>
    </div>
  );
}
