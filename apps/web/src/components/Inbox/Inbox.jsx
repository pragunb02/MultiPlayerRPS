import { Link, useNavigate } from "react-router";
import { CHALLENGE_STATES, getGame } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { useAction } from "../../hooks/useAction.js";
import { useDisclosureMenu } from "../../hooks/useDisclosureMenu.js";
import { Button } from "../Button/Button.jsx";
import { CHALLENGE_COPY } from "../Challenges/challengeCopy.js";
import { useChallengeInbox } from "../Challenges/challengesContext.js";
import { Bilingual } from "../Profile/Bilingual.jsx";
import styles from "./Inbox.module.css";

const gameName = (gameId) => getGame(gameId)?.name ?? "a game";

/** Whether a challenge belongs in the inbox, and whether it asks the player to do something. */
function placeOf(challenge) {
  if (challenge.state === CHALLENGE_STATES.OPEN && challenge.forYou) return "asks";
  if (challenge.state === CHALLENGE_STATES.ACCEPTED && challenge.own && challenge.room !== undefined)
    return "asks";
  if (challenge.state === CHALLENGE_STATES.OPEN && challenge.own) return "waits";
  return "";
}

/** A challenge sent to the player: Accept and go, or No thanks. */
function SentToYou({ challenge }) {
  const { api } = useServices();
  const navigate = useNavigate();
  const { remember } = useChallengeInbox();
  const accept = useAction(
    async () => {
      const { challenge: accepted, room } = await api.acceptChallenge(challenge.id);
      remember(accepted);
      navigate(paths.room(room.gameId, room.code));
    },
    { id: "inbox.accept" },
  );
  const decline = useAction(async () => remember(await api.declineChallenge(challenge.id)), {
    id: "inbox.decline",
  });
  return (
    <>
      <Bilingual copy={CHALLENGE_COPY.challengesYou(challenge.fromName, gameName(challenge.gameId))} />
      <div className={styles.actions}>
        <Button control="inbox.accept" action={accept}>
          Accept and go
        </Button>
        <Button control="inbox.decline" variant="secondary" action={decline}>
          No thanks
        </Button>
      </div>
    </>
  );
}

/** One of the player's own challenges: taken, with Go and play, or still open, with its page and Take back. */
function Yours({ challenge }) {
  const { api } = useServices();
  const { remember } = useChallengeInbox();
  const withdraw = useAction(async () => remember(await api.withdrawChallenge(challenge.id)), {
    id: "inbox.withdraw",
  });
  const game = gameName(challenge.gameId);
  if (challenge.state === CHALLENGE_STATES.ACCEPTED) {
    return (
      <>
        <Bilingual copy={CHALLENGE_COPY.tookYours(challenge.acceptedName, game)} />
        <Link
          className={styles.link}
          to={paths.room(challenge.room.gameId, challenge.room.code)}
          data-cc-control="inbox.play"
        >
          Go and play
        </Link>
      </>
    );
  }
  return (
    <>
      <p className={styles.waiting}>Your {game} challenge is waiting for someone to take it.</p>
      <div className={styles.actions}>
        <Link className={styles.link} to={paths.challenge(challenge.id)} data-cc-control="inbox.open">
          Share it
        </Link>
        <Button control="inbox.withdraw" variant="secondary" action={withdraw}>
          Take back
        </Button>
      </div>
    </>
  );
}

/**
 * The inbox under the header (CC-207, the minimal CC-147): challenges sent to the player, theirs that someone took,
 * and theirs still waiting. A challenge whose popup got Not now, or was left for a minute, is here. The button shows
 * how many ask for an answer. Signed-out visitors have no inbox.
 */
export function Inbox() {
  const { challenges } = useChallengeInbox();
  const { open, toggle, buttonRef, panelRef } = useDisclosureMenu();
  const listed = challenges.filter((challenge) => placeOf(challenge) !== "");
  const asks = listed.filter((challenge) => placeOf(challenge) === "asks").length;
  const label = asks === 0 ? "Inbox" : `Inbox, ${asks} waiting`;

  return (
    <div className={styles.inbox}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        aria-label={label}
        aria-expanded={open}
        aria-controls="header-inbox"
        data-cc-control="header.inbox"
        onClick={toggle}
      >
        Inbox
        {asks > 0 && (
          <span className={styles.count} aria-hidden="true">
            {asks}
          </span>
        )}
      </button>
      <section
        id="header-inbox"
        ref={panelRef}
        className={`${styles.panel} ${open ? styles.open : ""}`}
        aria-label="Inbox"
      >
        <h2 className={styles.heading}>Inbox</h2>
        {listed.length === 0 ? (
          <Bilingual copy={CHALLENGE_COPY.inboxEmpty} />
        ) : (
          <ul className={styles.list}>
            {listed.map((challenge) => (
              <li key={challenge.id} className={styles.item}>
                {challenge.own ? <Yours challenge={challenge} /> : <SentToYou challenge={challenge} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
