import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { InviteArt } from "../../art/illustrations/InviteArt.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { HowToPlayFold } from "../../components/HowToPlay/HowToPlay.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useFlag } from "../../hooks/useFlag.js";
import styles from "./JoinChooser.module.css";

/**
 * Someone opened a room link without a session (CC-086): before anything is created for them, they choose how
 * to join — as a guest right away, or with an account (log in or sign up, then straight back to this room).
 * With the `how_to_play` flag on, the game's How to play is there before they choose, because a friend who comes by
 * a link never sees the lobby (CC-349).
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
  // The page joins the room as soon as the guest session exists, and this chooser goes away.
  const playAsGuest = useAction(onPlayAsGuest, { id: "join.guest" });
  const howToPlayOn = useFlag("how_to_play");

  // Announce the choice: screen readers start here, keyboard users tab on to the three ways in.
  useEffect(() => {
    heading.current.focus();
  }, []);

  const invitedTo = game ? `You're invited to play ${game.name}` : "You're invited to play";
  return (
    <section className={styles.chooser} aria-labelledby="join-chooser-heading">
      <PageTitle>{`${game ? `${game.name} · ` : ""}Room ${code}`}</PageTitle>
      <div className={styles.card}>
        <InviteArt className={styles.art} />
        <h1 id="join-chooser-heading" ref={heading} tabIndex={-1} className={styles.heading}>
          {invitedTo}
        </h1>
        <p className={styles.room}>
          {game && <GameIcon gameId={game.id} className={styles.gameIcon} />}
          Room code <strong className={styles.code}>{code}</strong>
        </p>
        {howToPlayOn && game && <HowToPlayFold gameId={game.id} />}
        <p className={styles.lead}>How do you want to join?</p>
        <div className={styles.actions}>
          <Button control="join.guest" size="lg" action={playAsGuest}>
            Play as guest
          </Button>
          <Link className={styles.link} to={paths.login(returnTo)} data-cc-control="join.login">
            Log in
          </Link>
          <Link className={styles.link} to={paths.signup(returnTo)} data-cc-control="join.signup">
            Sign up
          </Link>
        </div>
        <p className={styles.hint}>
          Playing as a guest? Sign up later and your XP and match history come with you.
        </p>
      </div>
    </section>
  );
}
