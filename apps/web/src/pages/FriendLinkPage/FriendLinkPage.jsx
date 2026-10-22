import { useState } from "react";
import { useParams } from "react-router";
import { FRIEND_REQUEST_RESULTS } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { InviteArt } from "../../art/illustrations/InviteArt.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { Card } from "../../components/Card/Card.jsx";
import { FRIENDS_COPY, linkInviteCopy } from "../../components/Friends/friendsCopy.js";
import { PageHeader } from "../../components/Page/Page.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
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
        <div>
          <Button as="link" to={paths.friends()} control="friend_link.friends" variant="secondary">
            See your friends
          </Button>
        </div>
      </>
    );
  }
  if (identity?.kind !== "user") {
    // A guest or a visitor keeps the link: it is not used until an account presses Add friend.
    const back = paths.friendLink(token);
    return (
      <>
        <Bilingual copy={FRIENDS_COPY.guest} />
        <div className={styles.actions}>
          <Button as="link" to={paths.signup(back)} control="friend_link.signup">
            Save progress
          </Button>
          <Button as="link" to={paths.login(back)} control="friend_link.login" variant="secondary">
            Log in
          </Button>
        </div>
      </>
    );
  }
  return (
    <div className={styles.actions}>
      <Button control="friend_link.add" action={add} pendingLabel="Sending…">
        Add friend
      </Button>
      <Button as="link" to={paths.home()} control="friend_link.not_now" variant="ghost">
        Not now
      </Button>
    </div>
  );
}

/**
 * A "be my friend" link at `/friends/add/:token` (CC-052, ADR-066.3). It shows who made it: an adult's name, or "A
 * ClassiCade player" for anyone else, with their avatar. Opening it never uses it up, so a link preview or a guest
 * who signs up first loses nothing. Add friend uses it and sends its maker a request. A link that no longer works
 * is the shared dead end, with a way to play (CC-323).
 */
export function FriendLinkPage() {
  const { token } = useParams();
  const link = useFriendLink(token);
  if (link.status === "gone") {
    return (
      <section className={styles.page}>
        <PageTitle>Be my friend</PageTitle>
        <EmptyState
          title="This friend link has ended"
          headingLevel={1}
          art={<InviteArt />}
          action={
            <Button as="link" to={paths.home()} control="friend_link.home">
              Play a game
            </Button>
          }
        >
          <Bilingual copy={FRIENDS_COPY.linkGone} as="span" />
        </EmptyState>
      </section>
    );
  }
  let body;
  if (link.status === "loading") {
    body = <Skeleton label="Loading the friend link…" shape="card" />;
  } else if (link.status === "error") {
    body = (
      <ErrorState title="Couldn't open this friend link." control="friend_link">
        {link.error.message}
      </ErrorState>
    );
  } else {
    body = (
      <Card as="div" variant="accent" tone="primary">
        <div className={styles.invite}>
          <Avatar avatar={link.invite.avatar} size={72} />
          <Bilingual copy={linkInviteCopy(link.invite.displayName)} />
        </div>
        <Answer invite={link.invite} use={link.use} token={token} />
      </Card>
    );
  }
  return (
    <section className={styles.page}>
      <PageTitle>Be my friend</PageTitle>
      <PageHeader title="Friend link" />
      {body}
    </section>
  );
}
