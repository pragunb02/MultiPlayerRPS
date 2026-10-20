import { useState } from "react";
import { Link, useParams } from "react-router";
import { FRIEND_REQUEST_RESULTS } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { FRIENDS_COPY, linkInviteCopy } from "../../components/Friends/friendsCopy.js";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useFriendLink } from "../../hooks/useFriends.js";
import { useSession } from "../../hooks/useSession.js";
import styles from "../FriendsPage/FriendsPage.module.css";

/** What the player can do with a link that works: add its maker, or save their progress first. */
function Answer({ invite, use, token }) {
  const { identity } = useSession();
  const [result, setResult] = useState("");
  const add = useAction(async () => setResult(await use()), { id: "friend_link.add" });
  if (invite.own === true) {
    return <Bilingual copy={FRIENDS_COPY.linkOwn} />;
  }
  if (result !== "") {
    return (
      <>
        <Bilingual
          copy={
            result === FRIEND_REQUEST_RESULTS.FRIENDS ? FRIENDS_COPY.alreadyFriends : FRIENDS_COPY.linkSent
          }
        />
        <Link to={paths.friends()} data-cc-control="friend_link.friends">
          See your friends
        </Link>
      </>
    );
  }
  if (identity?.kind !== "user") {
    // A guest or a visitor keeps the link: it is not used until an account presses Add friend.
    const back = paths.friendLink(token);
    return (
      <>
        <Bilingual copy={FRIENDS_COPY.guest} />
        <p className={styles.actions}>
          <Link to={paths.signup(back)} className={styles.cta} data-cc-control="friend_link.signup">
            Save progress
          </Link>
          <Link to={paths.login(back)} data-cc-control="friend_link.login">
            Log in
          </Link>
        </p>
      </>
    );
  }
  return (
    <p className={styles.actions}>
      <Button control="friend_link.add" action={add} pendingLabel="Sending…">
        Add friend
      </Button>
      <Link to={paths.home()} data-cc-control="friend_link.not_now">
        Not now
      </Link>
    </p>
  );
}

/**
 * A "be my friend" link at `/friends/add/:token` (CC-052, ADR-066.3). It shows who made it: an adult's name, or "A
 * ClassiCade player" for anyone else, with their avatar. Opening it never uses it up, so a link preview or a guest
 * who signs up first loses nothing. Add friend uses it and sends its maker a request.
 */
export function FriendLinkPage() {
  const { token } = useParams();
  const link = useFriendLink(token);
  let body;
  if (link.status === "loading") {
    body = <p>Loading…</p>;
  } else if (link.status === "gone") {
    body = (
      <div className={styles.card}>
        <Bilingual copy={FRIENDS_COPY.linkGone} />
        <Link to={paths.home()} data-cc-control="friend_link.home">
          Play a game
        </Link>
      </div>
    );
  } else if (link.status === "error") {
    body = <p role="alert">Couldn&apos;t open this friend link. {link.error.message}</p>;
  } else {
    body = (
      <div className={styles.card}>
        <div className={styles.invite}>
          <Avatar avatar={link.invite.avatar} size={72} />
          <Bilingual copy={linkInviteCopy(link.invite.displayName)} />
        </div>
        <Answer invite={link.invite} use={link.use} token={token} />
      </div>
    );
  }
  return (
    <section className={styles.page}>
      <PageTitle>Be my friend</PageTitle>
      <h1>Friend link</h1>
      {body}
    </section>
  );
}
