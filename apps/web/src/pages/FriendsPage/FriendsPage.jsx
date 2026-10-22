import { useState } from "react";
import { Link } from "react-router";
import { FRIEND_ANSWERS, SHARE_CHANNELS } from "@classicade/shared";
import { paths, withShareChannel } from "../../app/paths.js";
import { siteOrigin } from "../../app/siteOrigin.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { Card } from "../../components/Card/Card.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { FRIENDS_COPY, PRESENCE_LABEL, VIA_LABEL } from "../../components/Friends/friendsCopy.js";
import { Modal } from "../../components/Modal/Modal.jsx";
import { PageHeader, Section, Sections } from "../../components/Page/Page.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { WhatsAppLink } from "../../components/WhatsAppLink/WhatsAppLink.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useFriends, useMakeFriendLink } from "../../hooks/useFriends.js";
import { friendLinkText, shareMessage } from "../../lib/shareText.js";
import styles from "./FriendsPage.module.css";

/** A guest cannot have friends (owner decision): the way to save their progress, back to this page after. */
function GuestPrompt() {
  return (
    <Card as="div">
      <Bilingual copy={FRIENDS_COPY.guest} />
      <div className={styles.actions}>
        <Button as="link" to={paths.signup(paths.friends())} control="friends.signup">
          Save progress
        </Button>
        <Button as="link" to={paths.login(paths.friends())} control="friends.login" variant="secondary">
          Log in
        </Button>
      </div>
    </Card>
  );
}

/** A visitor has no player yet, so there is nothing to load: the way to an account, back to this page after. */
function VisitorPrompt() {
  return (
    <EmptyState
      title="Friends are for accounts"
      action={
        <Button as="link" to={paths.signup(paths.friends())} control="friends.signup">
          Sign up
        </Button>
      }
      secondary={
        <Button as="link" to={paths.login(paths.friends())} control="friends.login" variant="secondary">
          Log in
        </Button>
      }
    >
      Sign up or log in to add friends and see who is online.
    </EmptyState>
  );
}

/** One request waiting for the player, with Accept and "Not now", which declines without telling anyone. */
function Incoming({ request, onAnswer }) {
  const accept = useAction(() => onAnswer(request.requestId, FRIEND_ANSWERS.ACCEPT), {
    id: "friends.accept",
  });
  const decline = useAction(() => onAnswer(request.requestId, FRIEND_ANSWERS.DECLINE), {
    id: "friends.decline",
  });
  return (
    <li className={styles.item}>
      <Avatar avatar={request.avatar} size={36} />
      <span className={styles.who}>
        <span className={styles.name}>{request.displayName}</span>
        <span className={styles.muted}>{VIA_LABEL[request.via]}</span>
      </span>
      <span className={styles.buttons}>
        <Button
          control="friends.accept"
          size="sm"
          action={accept}
          pendingLabel="Adding…"
          aria-label={`Accept ${request.displayName}`}
          reason={decline.busy ? "Sending your answer" : ""}
        >
          Accept
        </Button>
        <Button
          control="friends.decline"
          variant="secondary"
          size="sm"
          action={decline}
          aria-label={`Not now, ${request.displayName}`}
          reason={accept.busy ? "Sending your answer" : ""}
        >
          Not now
        </Button>
      </span>
    </li>
  );
}

/**
 * The question before a removal. Nobody is told, and it cannot be undone except by asking again, so it is a
 * destructive confirm: a tap beside the dialog does not close it.
 */
function RemoveDialog({ friend, onClose, onRemove }) {
  const remove = useAction(
    async () => {
      await onRemove(friend.handle);
      onClose();
    },
    { id: "friends.remove.confirm" },
  );
  return (
    <Modal
      open
      destructive
      title={`Remove ${friend.displayName}?`}
      onClose={onClose}
      actions={
        <>
          <Button control="friends.remove.cancel" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button control="friends.remove.confirm" variant="danger" action={remove} pendingLabel="Removing…">
            Remove
          </Button>
        </>
      }
    >
      <p>
        {friend.displayName} won&apos;t be your friend any more, and you won&apos;t see each other online.{" "}
        {friend.displayName} is not told.
      </p>
    </Modal>
  );
}

/** One friend: avatar, name, a profile link for an adult (ADR-065.2), presence in words and colour, and Remove. */
function Friend({ friend, onAskRemove }) {
  return (
    <li className={styles.item}>
      <Avatar avatar={friend.avatar} size={36} />
      <span className={styles.who}>
        {friend.profile === undefined ? (
          <span className={styles.name}>{friend.displayName}</span>
        ) : (
          <Link to={paths.player(friend.profile)} className={styles.name} data-cc-control="friends.profile">
            {friend.displayName}
          </Link>
        )}
        <span className={`${styles.presence} ${styles[friend.presence]}`}>
          <span className={styles.dot} aria-hidden="true" />
          {PRESENCE_LABEL[friend.presence]}
        </span>
      </span>
      <Button
        control="friends.remove"
        variant="ghost"
        size="sm"
        aria-label={`Remove ${friend.displayName}`}
        onClick={() => onAskRemove(friend)}
      >
        Remove
      </Button>
    </li>
  );
}

/** A request the player sent, which reads "Request sent" until it is accepted or runs out, whatever happens. */
function Outgoing({ request, onCancel }) {
  const cancel = useAction(() => onCancel(request.requestId), { id: "friends.cancel" });
  return (
    <li className={styles.item}>
      <Avatar avatar={request.avatar} size={36} />
      <span className={styles.who}>
        <span className={styles.name}>{request.displayName}</span>
        <span className={styles.muted}>Request sent</span>
      </span>
      <Button
        control="friends.cancel"
        variant="ghost"
        size="sm"
        action={cancel}
        pendingLabel="Cancelling…"
        aria-label={`Cancel the request to ${request.displayName}`}
      >
        Cancel
      </Button>
    </li>
  );
}

/** Makes a one-use friend link, with Copy and Send on WhatsApp (CC-052). The token is shown here only. */
function FriendLink({ origin = siteOrigin() }) {
  const makeLink = useMakeFriendLink();
  const toast = useToast();
  const [link, setLink] = useState("");
  const make = useAction(async () => setLink(`${origin}${paths.friendLink((await makeLink()).token)}`), {
    id: "friends.link.make",
  });
  return (
    <Section title="Your friend link" description="A link that adds you as a friend, once.">
      <Bilingual copy={FRIENDS_COPY.linkIntro} />
      {link === "" ? (
        <div>
          <Button control="friends.link.make" action={make} pendingLabel="Making…">
            Make a friend link
          </Button>
        </div>
      ) : (
        <>
          <Field
            label="Friend link"
            kind="copy"
            value={withShareChannel(link, SHARE_CHANNELS.COPY)}
            control="friends.link.copy"
            copyLabel="Copy link"
            copyFailure="Couldn't copy. Select the link and copy it"
            onCopied={() => toast.show("Link copied", { tone: "success" })}
          />
          <div className={styles.actions}>
            <WhatsAppLink
              message={shareMessage({
                text: friendLinkText(),
                url: withShareChannel(link, SHARE_CHANNELS.WHATSAPP),
              })}
              control="friends.link.whatsapp"
            />
          </div>
        </>
      )}
    </Section>
  );
}

/** The Appear offline switch, and who sees presence at all. */
function AppearOffline({ on, onChange }) {
  const toggle = useAction(() => onChange(!on), { id: "friends.appear_offline" });
  return (
    <Section title="Appear offline" description="Whether your friends see you online.">
      <Bilingual copy={FRIENDS_COPY.appearOffline} />
      <div>
        <Button
          control="friends.appear_offline"
          variant="secondary"
          action={toggle}
          pendingLabel="Saving…"
          aria-pressed={on}
        >
          {on ? "Appear offline: on" : "Appear offline: off"}
        </Button>
      </div>
      <Bilingual copy={FRIENDS_COPY.presenceOnlyFriends} />
    </Section>
  );
}

/** Everything of an account's friends view, as titled sections with the same rhythm as every page. */
function FriendsView({ friends }) {
  const { view } = friends;
  const [removing, setRemoving] = useState(undefined);
  return (
    <Sections>
      {view.incoming.length > 0 && (
        <Section
          title="Friend requests"
          description={`${view.incoming.length} waiting for your answer.`}
          id="friend-requests"
        >
          {view.safetyTips && <Bilingual copy={FRIENDS_COPY.safety} />}
          <ul className={styles.list} aria-label="Friend requests">
            {view.incoming.map((request) => (
              <Incoming key={request.requestId} request={request} onAnswer={friends.answer} />
            ))}
          </ul>
        </Section>
      )}
      <Section title="Your friends" description="Who is online or in a game right now." id="friends-list">
        {view.friends.length === 0 ? (
          <EmptyState title="No friends yet" headingLevel={3}>
            <Bilingual copy={FRIENDS_COPY.empty} as="span" />
          </EmptyState>
        ) : (
          <ul className={styles.list} aria-label="Friends">
            {view.friends.map((friend) => (
              <Friend key={friend.handle} friend={friend} onAskRemove={setRemoving} />
            ))}
          </ul>
        )}
      </Section>
      {view.outgoing.length > 0 && (
        <Section title="Requests you sent" description="Waiting for the other player." id="friends-sent">
          <ul className={styles.list} aria-label="Requests you sent">
            {view.outgoing.map((request) => (
              <Outgoing key={request.requestId} request={request} onCancel={friends.cancel} />
            ))}
          </ul>
        </Section>
      )}
      <FriendLink />
      <AppearOffline on={view.settings.appearOffline} onChange={friends.setAppearOffline} />
      {removing !== undefined && (
        <RemoveDialog friend={removing} onClose={() => setRemoving(undefined)} onRemove={friends.remove} />
      )}
    </Sections>
  );
}

/**
 * Your friends at `/friends` (CC-052, ADR-066): who they are and whether they are online or in a game, the requests
 * waiting for you and the ones you sent, your friend link and the Appear offline switch. Friends are for accounts
 * only, so a guest sees how to save their progress and a visitor how to sign up.
 */
export function FriendsPage() {
  const friends = useFriends();
  let body;
  if (friends.status === "loading") {
    body = <Skeleton label="Loading your friends…" shape="row" count={3} />;
  } else if (friends.status === "guest") {
    body = <GuestPrompt />;
  } else if (friends.status === "visitor") {
    body = <VisitorPrompt />;
  } else if (friends.status === "error") {
    body = (
      <ErrorState title="Couldn't load your friends." control="friends" onRetry={friends.retry}>
        {friends.error.message}
      </ErrorState>
    );
  } else {
    body = <FriendsView friends={friends} />;
  }
  return (
    <section className={styles.page}>
      <PageTitle>Your friends</PageTitle>
      <PageHeader title="Friends" lede="The people you play with, and who is online." />
      {body}
    </section>
  );
}
