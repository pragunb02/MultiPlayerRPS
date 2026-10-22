import { useState } from "react";
import { Link } from "react-router";
import { FRIEND_ANSWERS, SHARE_CHANNELS } from "@classicade/shared";
import { paths, withShareChannel } from "../../app/paths.js";
import { siteOrigin } from "../../app/siteOrigin.js";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { FRIENDS_COPY, PRESENCE_LABEL, VIA_LABEL } from "../../components/Friends/friendsCopy.js";
import { InviteDialog } from "../../components/Friends/InviteDialog.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { WhatsAppLink } from "../../components/WhatsAppLink/WhatsAppLink.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useFlag } from "../../hooks/useFlag.js";
import { useFriends, useMakeFriendLink } from "../../hooks/useFriends.js";
import { friendLinkText, shareMessage } from "../../lib/shareText.js";
import styles from "./FriendsPage.module.css";

/** A guest cannot have friends (owner decision): the way to save their progress, back to this page after. */
function GuestPrompt() {
  return (
    <div className={styles.card}>
      <Bilingual copy={FRIENDS_COPY.guest} />
      <p className={styles.actions}>
        <Link to={paths.signup(paths.friends())} className={styles.cta} data-cc-control="friends.signup">
          Save progress
        </Link>
        <Link to={paths.login(paths.friends())} data-cc-control="friends.login">
          Log in
        </Link>
      </p>
    </div>
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

/** The question before a removal. Nobody is told, and it cannot be undone except by asking again. */
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
      title={`Remove ${friend.displayName}?`}
      onClose={onClose}
      actions={
        <>
          <Button control="friends.remove.cancel" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button control="friends.remove.confirm" variant="accent" action={remove} pendingLabel="Removing…">
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

/**
 * One friend: avatar, name, a profile link for an adult (ADR-065.2), presence, Invite (CC-052 part 2, behind its
 * flag) and Remove.
 */
function Friend({ friend, onAskRemove, onInvite }) {
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
          {PRESENCE_LABEL[friend.presence]}
        </span>
      </span>
      {onInvite !== undefined && (
        <Button
          control="friends.invite"
          variant="secondary"
          className={styles.small}
          aria-label={`Invite ${friend.displayName}`}
          onClick={() => onInvite(friend)}
        >
          Invite
        </Button>
      )}
      <Button
        control="friends.remove"
        variant="ghost"
        className={styles.small}
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
        className={styles.small}
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
  const copy = useAction(
    async () => {
      try {
        await navigator.clipboard.writeText(withShareChannel(link, SHARE_CHANNELS.COPY));
      } catch (cause) {
        throw new Error("Couldn't copy. Select the link and copy it", { cause });
      }
      toast.show("Link copied", { tone: "success" });
    },
    { id: "friends.link.copy" },
  );
  return (
    <section className={styles.card} aria-labelledby="friend-link">
      <h2 id="friend-link">Your friend link</h2>
      <Bilingual copy={FRIENDS_COPY.linkIntro} />
      {link === "" ? (
        <Button control="friends.link.make" action={make} pendingLabel="Making…">
          Make a friend link
        </Button>
      ) : (
        <>
          <label className={styles.label}>
            <span>Friend link</span>
            <input
              readOnly
              value={withShareChannel(link, SHARE_CHANNELS.COPY)}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <p className={styles.actions}>
            <Button control="friends.link.copy" action={copy} doneLabel="Copied">
              Copy link
            </Button>
            <WhatsAppLink
              message={shareMessage({
                text: friendLinkText(),
                url: withShareChannel(link, SHARE_CHANNELS.WHATSAPP),
              })}
              control="friends.link.whatsapp"
            />
          </p>
        </>
      )}
    </section>
  );
}

/** The Appear offline switch, and who sees presence at all. */
function AppearOffline({ on, onChange }) {
  const toggle = useAction(() => onChange(!on), { id: "friends.appear_offline" });
  return (
    <section className={styles.card} aria-labelledby="appear-offline">
      <h2 id="appear-offline">Appear offline</h2>
      <Bilingual copy={FRIENDS_COPY.appearOffline} />
      <Button
        control="friends.appear_offline"
        variant="secondary"
        action={toggle}
        pendingLabel="Saving…"
        aria-pressed={on}
      >
        {on ? "Appear offline: on" : "Appear offline: off"}
      </Button>
      <Bilingual copy={FRIENDS_COPY.presenceOnlyFriends} />
    </section>
  );
}

/** Everything of an account's friends view. */
function FriendsView({ friends }) {
  const { view } = friends;
  const [removing, setRemoving] = useState(undefined);
  const [inviting, setInviting] = useState(undefined);
  const invites = useFlag("friend_invites");
  // The dialog follows the friend's presence while it is open, and closes if they stop being a friend.
  const invitingFriend = view.friends.find((friend) => friend.handle === inviting?.handle);
  return (
    <>
      {view.incoming.length > 0 && (
        <section className={styles.section} aria-labelledby="friend-requests">
          <h2 id="friend-requests">Friend requests</h2>
          {view.safetyTips && <Bilingual copy={FRIENDS_COPY.safety} />}
          <ul className={styles.list} aria-label="Friend requests">
            {view.incoming.map((request) => (
              <Incoming key={request.requestId} request={request} onAnswer={friends.answer} />
            ))}
          </ul>
        </section>
      )}
      <section className={styles.section} aria-labelledby="friends-list">
        <h2 id="friends-list">Your friends</h2>
        {view.friends.length === 0 ? (
          <Bilingual copy={FRIENDS_COPY.empty} />
        ) : (
          <ul className={styles.list} aria-label="Friends">
            {view.friends.map((friend) => (
              <Friend
                key={friend.handle}
                friend={friend}
                onAskRemove={setRemoving}
                onInvite={invites ? setInviting : undefined}
              />
            ))}
          </ul>
        )}
      </section>
      {view.outgoing.length > 0 && (
        <section className={styles.section} aria-labelledby="friends-sent">
          <h2 id="friends-sent">Requests you sent</h2>
          <ul className={styles.list} aria-label="Requests you sent">
            {view.outgoing.map((request) => (
              <Outgoing key={request.requestId} request={request} onCancel={friends.cancel} />
            ))}
          </ul>
        </section>
      )}
      <FriendLink />
      <AppearOffline on={view.settings.appearOffline} onChange={friends.setAppearOffline} />
      {invitingFriend !== undefined && (
        <InviteDialog friend={invitingFriend} onClose={() => setInviting(undefined)} />
      )}
      {removing !== undefined && (
        <RemoveDialog friend={removing} onClose={() => setRemoving(undefined)} onRemove={friends.remove} />
      )}
    </>
  );
}

/**
 * Your friends at `/friends` (CC-052, ADR-066): who they are and whether they are online or in a game, the requests
 * waiting for you and the ones you sent, your friend link and the Appear offline switch. Friends are for accounts
 * only, so a guest sees how to save their progress.
 */
export function FriendsPage() {
  const friends = useFriends();
  let body;
  if (friends.status === "loading") {
    body = <p>Loading…</p>;
  } else if (friends.status === "guest") {
    body = <GuestPrompt />;
  } else if (friends.status === "error") {
    body = (
      <p role="alert">
        Couldn&apos;t load your friends. {friends.error.message}{" "}
        <Button control="friends.retry" variant="secondary" onClick={friends.retry}>
          Retry
        </Button>
      </p>
    );
  } else {
    body = <FriendsView friends={friends} />;
  }
  return (
    <section className={styles.page}>
      <PageTitle>Your friends</PageTitle>
      <h1>Friends</h1>
      {body}
    </section>
  );
}
