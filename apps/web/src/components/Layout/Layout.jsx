import { Link, NavLink, Outlet } from "react-router";
import { useSession } from "../../hooks/useSession.js";
import styles from "./Layout.module.css";

/** App shell: header with brand, navigation and who you are; pages render into <Outlet />. */
export function Layout() {
  const session = useSession();

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label="ClassiCade home">
          ClassiCade
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <NavLink to="/" end>
            Play
          </NavLink>
        </nav>
        <div className={styles.identity} aria-live="polite">
          {session.status === "ready" && (
            <span title={session.identity.kind}>{session.identity.displayName}</span>
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
