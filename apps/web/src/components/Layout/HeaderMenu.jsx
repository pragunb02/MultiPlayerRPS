import { useId } from "react";
import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { Button } from "../Button/Button.jsx";
import { FEEDBACK_TEXT } from "../Feedback/feedbackText.js";
import { LevelChip } from "../LevelChip/LevelChip.jsx";
import { SoundControl } from "../SoundControl/SoundControl.jsx";
import { PlayerName } from "./AccountMenu.jsx";
import { currentIf, SECTIONS } from "./headerLayout.js";
import styles from "./Layout.module.css";

/** One labelled group of the menu, with its small heading. */
function Group({ title, children }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={styles.group}>
      <p id={id} className={styles.groupTitle}>
        {title}
      </p>
      {children}
    </div>
  );
}

/** The two game links: in the row on a wide screen and a tablet, in the menu's Play group on a phone. */
export function PlayLinks({ section }) {
  return (
    <>
      <Link
        to={paths.home()}
        aria-current={currentIf(SECTIONS.GAMES, section)}
        data-cc-control="header.games"
      >
        Games
      </Link>
      <Link
        to={paths.leaderboards()}
        aria-current={currentIf(SECTIONS.LEADERBOARDS, section)}
        data-cc-control="header.leaderboards"
      >
        Leaderboards
      </Link>
    </>
  );
}

/**
 * The compact header's menu (CC-259, rebuilt in CC-324): full-width rows in four groups, Play, Social, You and
 * Settings, under the header's one row. It pushes the page down instead of covering it, so a tap meant for the page
 * never lands on it. Play holds the game links only on a phone, where the row has no room for them.
 *
 * @param {{
 *   id: string,
 *   panelRef: import("react").RefObject<HTMLDivElement | null>,
 *   open: boolean,
 *   withPlay: boolean,
 *   section: string | undefined,
 *   identity: { id: string, kind: string, displayName: string } | undefined,
 *   signedOutLinks: import("react").ReactNode,
 *   logout: ReturnType<typeof import("../../hooks/useAction.js").useAction>,
 *   admin: boolean,
 *   onFeedback: () => void,
 * }} props
 */
export function HeaderMenu({
  id,
  panelRef,
  open,
  withPlay,
  section,
  identity,
  signedOutLinks,
  logout,
  admin,
  onFeedback,
}) {
  return (
    <div id={id} ref={panelRef} className={`${styles.menu} ${open ? styles.open : ""}`}>
      {withPlay && (
        <Group title="Play">
          <nav aria-label="Main" className={styles.menuLinks}>
            <PlayLinks section={section} />
          </nav>
        </Group>
      )}
      {identity && (
        <Group title="Social">
          <div className={styles.menuLinks}>
            <Link
              to={paths.friends()}
              aria-current={currentIf(SECTIONS.FRIENDS, section)}
              data-cc-control="header.menu_friends"
            >
              Friends
            </Link>
          </div>
        </Group>
      )}
      <Group title="You">
        {identity && (
          <div className={styles.youRow}>
            <LevelChip key={identity.id} />
            <PlayerName identity={identity} />
          </div>
        )}
        <div className={styles.menuLinks}>
          {identity && (
            <Link
              to={paths.profile()}
              aria-current={currentIf(SECTIONS.PROFILE, section)}
              data-cc-control="header.profile"
            >
              Profile
            </Link>
          )}
        </div>
        <div className={styles.authRow}>
          {signedOutLinks}
          {identity?.kind === "user" && (
            <Button control="header.logout" variant="ghost" action={logout}>
              Log out
            </Button>
          )}
        </div>
      </Group>
      <Group title="Settings">
        <SoundControl />
        <div className={styles.menuLinks}>
          {/* Shown to admins only. Everyone else never sees a sign of the console (CC-233). */}
          {admin && (
            <Link
              to={paths.admin()}
              aria-current={currentIf(SECTIONS.ADMIN, section)}
              data-cc-control="header.admin"
            >
              Console
            </Link>
          )}
        </div>
        <div className={styles.authRow}>
          <Button control="header.feedback" variant="ghost" onClick={onFeedback}>
            {FEEDBACK_TEXT.open}
          </Button>
        </div>
      </Group>
    </div>
  );
}
