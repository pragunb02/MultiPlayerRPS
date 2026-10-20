import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CHALLENGE_STATES, GAME_IDS, INVITE_KEEP_AFTER_MS, PRESENCE } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { useAction } from "../../hooks/useAction.js";
import { useCreateRoom } from "../../hooks/useCreateRoom.js";
import { useFlag } from "../../hooks/useFlag.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { Button } from "../Button/Button.jsx";
import { INVITE_COPY } from "../Friends/inviteCopy.js";
import { Bilingual } from "../Profile/Bilingual.jsx";
import { useToast } from "../Toast/toastContext.js";
import { useChallengeInbox } from "./challengesContext.js";
import styles from "./InviteWaiting.module.css";

/** The invite this player took that made this room, while its room waits for its sender. */
const takenInviteFor = (challenges, code) =>
  challenges.find(
    (challenge) =>
      challenge.took &&
      challenge.forYou &&
      challenge.state === CHALLENGE_STATES.ACCEPTED &&
      challenge.room?.code === code,
  );

/** Whether the moment has come, re-rendering once when it does. */
function useReached(moment) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (now >= moment) return undefined;
    // A timer may fire a moment early, so the moment it stands for is never earlier than the one it waited for.
    const timer = setTimeout(() => setNow(Math.max(Date.now(), moment)), moment - now);
    return () => clearTimeout(timer);
  }, [moment, now]);
  return now >= moment;
}

/**
 * The friend who took an invite, in the room made for both, while its sender is not on the room page (CC-052
 * scenario 4): "X isn't here right now. We've told them." The sender got a popup, or finds one when they are back.
 * After INVITE_KEEP_AFTER_MS the friend may keep the invite for later or play Pip meanwhile: either sends the same
 * game back to the sender as an invite of their own, and leaves this room. Nothing shows for any other room.
 *
 * @param {{ room: { code: string, you: string, seats: ReadonlyArray<{ playerId: string, presence?: string, connected: boolean }> }, onLeave: () => Promise<unknown>, children: import("react").ReactNode }} props
 *   `onLeave` gives up the seat in this room. `children` is what the room shows instead, for any other room
 */
export function InviteWaiting({ room, onLeave, children }) {
  const { challenges } = useChallengeInbox();
  const invite = takenInviteFor(challenges, room.code);
  const sender = room.seats.find((seat) => seat.playerId !== room.you);
  const away =
    sender !== undefined && (sender.presence ?? (sender.connected ? PRESENCE.HERE : "")) !== PRESENCE.HERE;
  if (invite === undefined || !away) return children;
  return <Waiting key={invite.id} invite={invite} onLeave={onLeave} />;
}

function Waiting({ invite, onLeave }) {
  const { api } = useServices();
  const { remember } = useChallengeInbox();
  const navigate = useNavigate();
  const toast = useToast();
  const createRoom = useCreateRoom();
  const invites = useFlag("friend_invites");
  const due = useReached(invite.acceptedAt + INVITE_KEEP_AFTER_MS);
  const name = invite.fromName;

  /** Sends the invite back to its sender, and gives up the seat here. */
  const keep = async () => {
    remember(await api.inviteAgain(invite.id));
    await onLeave();
  };
  const later = useAction(
    async () => {
      await keep();
      toast.show(`${INVITE_COPY.kept(name).hi} ${INVITE_COPY.kept(name).en}`, {
        tone: "success",
        category: CATEGORIES.SOCIAL,
      });
      navigate(paths.friends(), { replace: true });
    },
    { id: "invite.keep" },
  );
  const pip = useAction(
    async () => {
      await keep();
      const code = await createRoom.playComputer({
        gameId: GAME_IDS.TIC_TAC_TOE,
        level: "easy",
        options: {},
      });
      navigate(paths.room(GAME_IDS.TIC_TAC_TOE, code), { replace: true });
    },
    { id: "invite.pip" },
  );
  const busy = later.busy || pip.busy ? "Sending your invite" : "";

  return (
    <div className={styles.card} role="status">
      <h2>Waiting for {name}</h2>
      <Bilingual copy={INVITE_COPY.isntHere(name)} />
      {due && invites && (
        <>
          <Bilingual copy={INVITE_COPY.keepOrPlay(name)} />
          <div className={styles.actions}>
            <Button control="invite.keep" action={later} reason={pip.busy ? busy : ""}>
              Keep it for later
            </Button>
            <Button control="invite.pip" variant="secondary" action={pip} reason={later.busy ? busy : ""}>
              Play Pip meanwhile
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
