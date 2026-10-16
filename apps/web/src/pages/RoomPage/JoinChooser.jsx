import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import styles from "./JoinChooser.module.css";

/**
 * Someone opened a room link without a session (CC-086): before anything is created for them, they choose how
 * to join — as a guest right away, or with an account (log in or sign up, then straight back to this room).
 *
 * @param {{
 *   code: string,
 *   game: Readonly<{ id: string, name: string }> | undefined,  unknown for an old `/room/:code` link
 *   returnTo: string,                                          this room's URL, for after logging in
 *   onPlayAsGuest: () => Promise<unknown>,                     starts a guest session
 * }} props
 */
export function JoinChooser({ code, game, returnTo, onPlayAsGuest }) {
  const heading = useRef(null);
  const [state, setState] = useState({ busy: false, error: "" });

  // Announce the choice: screen readers start here, keyboard users tab on to the three ways in.
  useEffect(() => {
    heading.current.focus();
  }, []);

  async function playAsGuest() {
    setState({ busy: true, error: "" });
    try {
      await onPlayAsGuest();
      // The page joins the room as soon as the guest session exists; this chooser goes away.
    } catch (error) {
      setState({ busy: false, error: error.message });
    }
  }

  const invitedTo = game ? `You're invited to play ${game.name}` : "You're invited to play";
  return (
    <section className={styles.chooser} aria-labelledby="join-chooser-heading">
      <PageTitle>{`${game ? `${game.name} · ` : ""}Room ${code}`}</PageTitle>
      <div className={styles.card}>
        <h1 id="join-chooser-heading" ref={heading} tabIndex={-1} className={styles.heading}>
          {invitedTo}
        </h1>
        <p className={styles.room}>
          Room code <strong className={styles.code}>{code}</strong>
        </p>
        <p className={styles.lead}>How do you want to join?</p>
        <div className={styles.actions}>
          <Button size="lg" onClick={playAsGuest} busy={state.busy}>
            Play as guest
          </Button>
          <Link className={styles.link} to={paths.login(returnTo)}>
            Log in
          </Link>
          <Link className={styles.link} to={paths.signup(returnTo)}>
            Sign up
          </Link>
        </div>
        <p className={styles.hint}>
          Playing as a guest? Sign up later and your XP and match history come with you.
        </p>
        {state.error && (
          <p role="alert" className={styles.alert}>
            {state.error}
          </p>
        )}
      </div>
    </section>
  );
}
