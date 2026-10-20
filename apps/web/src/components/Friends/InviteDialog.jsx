import { useState } from "react";
import { Link } from "react-router";
import { FRIEND_PRESENCE, GAMES, SHARE_CHANNELS } from "@classicade/shared";
import { paths, withShareChannel } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { siteOrigin } from "../../app/siteOrigin.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { useAction } from "../../hooks/useAction.js";
import { friendInviteText, shareMessage } from "../../lib/shareText.js";
import { Button } from "../Button/Button.jsx";
import { useChallengeInbox } from "../Challenges/challengesContext.js";
import { Modal } from "../Modal/Modal.jsx";
import { Bilingual } from "../Profile/Bilingual.jsx";
import { WhatsAppLink } from "../WhatsAppLink/WhatsAppLink.jsx";
import { INVITE_COPY } from "./inviteCopy.js";
import styles from "./InviteDialog.module.css";

/** What happens to the invite next, by where the friend is now (CC-052 scenarios 1 to 3). */
const SENT_COPY = Object.freeze({
  [FRIEND_PRESENCE.ONLINE]: INVITE_COPY.sentOnline,
  [FRIEND_PRESENCE.PLAYING]: INVITE_COPY.sentPlaying,
  [FRIEND_PRESENCE.OFFLINE]: INVITE_COPY.sentOffline,
});

/** One game to pick. Each sends the invite with the game's standard options. */
function GameChoice({ game, onPick }) {
  const send = useAction(() => onPick(game.id), { id: "friends.invite.game" });
  return (
    <li>
      <Button
        control="friends.invite.game"
        variant="secondary"
        className={styles.game}
        action={send}
        pendingLabel="Sending…"
      >
        <GameIcon gameId={game.id} className={styles.icon} />
        {game.name}
      </Button>
    </li>
  );
}

/** The invite sent: what happens next, and Send on WhatsApp too while the friend is offline. */
function Sent({ friend, challenge }) {
  const page = `${siteOrigin()}${paths.challenge(challenge.id)}`;
  const offline = friend.presence === FRIEND_PRESENCE.OFFLINE;
  return (
    <div className={styles.sent} role="status">
      <Bilingual copy={(SENT_COPY[friend.presence] ?? INVITE_COPY.sentOffline)(friend.displayName)} />
      <p className={styles.actions}>
        {offline && (
          <WhatsAppLink
            message={shareMessage({
              text: friendInviteText({ gameId: challenge.gameId }),
              url: withShareChannel(page, SHARE_CHANNELS.WHATSAPP),
            })}
            control="friends.invite.whatsapp"
          />
        )}
        <Link to={paths.challenge(challenge.id)} data-cc-control="friends.invite.open">
          See the invite
        </Link>
      </p>
    </div>
  );
}

/**
 * Invite a friend to a game (CC-052 part 2): pick one of the games, and the friend gets the invite on any page, when
 * their game ends, or in their inbox. The server answers a friend who is gone, a limit or a block as for anyone: the
 * button shows its words.
 *
 * @param {{ friend: { handle: string, displayName: string, presence: string }, onClose: () => void }} props
 */
export function InviteDialog({ friend, onClose }) {
  const { api } = useServices();
  const { remember } = useChallengeInbox();
  const [sent, setSent] = useState(undefined);
  const pick = async (gameId) => {
    const challenge = await api.createChallenge({ gameId, options: {}, to: { handle: friend.handle } });
    remember(challenge);
    setSent(challenge);
  };
  return (
    <Modal
      open
      title={sent === undefined ? `Invite ${friend.displayName}` : "Invite sent"}
      onClose={onClose}
      actions={
        <Button
          control="friends.invite.close"
          variant={sent === undefined ? "ghost" : "primary"}
          onClick={onClose}
        >
          {sent === undefined ? "Cancel" : "Done"}
        </Button>
      }
    >
      {sent === undefined ? (
        <>
          <Bilingual copy={INVITE_COPY.pickGame(friend.displayName)} />
          <ul className={styles.games} aria-label="Games">
            {GAMES.map((game) => (
              <GameChoice key={game.id} game={game} onPick={pick} />
            ))}
          </ul>
        </>
      ) : (
        <Sent friend={friend} challenge={sent} />
      )}
    </Modal>
  );
}
