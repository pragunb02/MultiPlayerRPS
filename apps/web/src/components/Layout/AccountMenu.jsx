import { NavLink } from "react-router";
import { paths } from "../../app/paths.js";
import { Svg } from "../../art/Svg.jsx";
import { useDisclosureMenu } from "../../hooks/useDisclosureMenu.js";
import { Button } from "../Button/Button.jsx";
import { FEEDBACK_TEXT } from "../Feedback/feedbackText.js";
import { SECTIONS } from "./headerLayout.js";
import styles from "./Layout.module.css";

/**
 * The player's name in the header. A long name is cut short with an ellipsis where the row has no room for it, but
 * the whole name stays in the text, so a screen reader and the title read it in full (CC-324). It never wraps one
 * letter per line again (the October audit). `data-cc-identity` says guest or account for the browser tests.
 *
 * @param {{ identity: { kind: string, displayName: string } }} props
 */
export function PlayerName({ identity }) {
  return (
    <span className={styles.name} title={identity.displayName} data-cc-identity={identity.kind}>
      {identity.displayName}
    </span>
  );
}

function Chevron() {
  return (
    <Svg viewBox="0 0 24 24" width={14} height={14} className={styles.chevron}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

/**
 * The wide header's account menu (CC-324): a button with the player's name, which opens a small panel with their
 * Profile and Friends, Feedback and, for an account, Log out. It is a disclosure, not an ARIA menu: Tab moves
 * through it, Escape closes it and gives the focus back to the button, and a press outside or a new page closes it.
 * The button glows as the current item while the player is on their profile or their friends.
 *
 * @param {{
 *   identity: { kind: string, displayName: string },
 *   section: string | undefined,
 *   logout: ReturnType<typeof import("../../hooks/useAction.js").useAction>,
 *   onFeedback: () => void,
 * }} props
 */
export function AccountMenu({ identity, section, logout, onFeedback }) {
  const { open, toggle, close, buttonRef, panelRef } = useDisclosureMenu();
  const current = section === SECTIONS.PROFILE || section === SECTIONS.FRIENDS;
  // The menu closes first and its button takes the focus, so the dialog gives the focus back to a button that is
  // still on screen when it closes (CC-290).
  const openFeedback = () => {
    close();
    buttonRef.current.focus();
    onFeedback();
  };
  return (
    <div className={styles.account}>
      <button
        type="button"
        ref={buttonRef}
        className={`${styles.accountButton} ${current ? styles.current : ""}`}
        aria-expanded={open}
        aria-controls="header-account"
        data-cc-control="header.account"
        onClick={toggle}
      >
        <PlayerName identity={identity} />
        <Chevron />
      </button>
      <div id="header-account" ref={panelRef} className={styles.accountPanel} hidden={!open}>
        {open && (
          <>
            <p className={styles.panelNote}>
              {identity.kind === "guest" ? "Playing as a guest" : "Signed in"}
            </p>
            <NavLink to={paths.profile()} className={styles.panelLink} data-cc-control="header.profile">
              Profile
            </NavLink>
            <NavLink to={paths.friends()} className={styles.panelLink} data-cc-control="header.friends">
              Friends
            </NavLink>
            <Button control="header.feedback" variant="ghost" onClick={openFeedback}>
              {FEEDBACK_TEXT.open}
            </Button>
            {identity.kind === "user" && (
              <Button control="header.logout" variant="ghost" action={logout}>
                Log out
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
