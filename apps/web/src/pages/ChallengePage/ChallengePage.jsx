import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { CHALLENGE_STATES, getGame, SHARE_CHANNELS } from "@classicade/shared";
import { paths, withShareChannel } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { siteOrigin } from "../../app/siteOrigin.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { InviteArt } from "../../art/illustrations/InviteArt.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { CHALLENGE_COPY } from "../../components/Challenges/challengeCopy.js";
import { INVITE_COPY } from "../../components/Friends/inviteCopy.js";
import { useChallengeInbox } from "../../components/Challenges/challengesContext.js";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { WhatsAppLink } from "../../components/WhatsAppLink/WhatsAppLink.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useChallenge } from "../../hooks/useChallenge.js";
import { useFlag } from "../../hooks/useFlag.js";
import { useSession } from "../../hooks/useSession.js";
import { challengeText, friendInviteText, shareMessage } from "../../lib/shareText.js";
import styles from "./ChallengePage.module.css";

const HOUR_MS = 60 * 60 * 1000;
const gameName = (gameId) => getGame(gameId)?.name ?? "a game";

/** "Open for 23 more hours", rounded up, so it never says 0 while the link still works. */
const hoursLeft = (expiresAt) => {
  const hours = Math.max(1, Math.ceil((expiresAt - Date.now()) / HOUR_MS));
  return `Open for ${hours} more ${hours === 1 ? "hour" : "hours"}.`;
};

/**
 * A challenge that is over, or a link that leads nowhere: honest about why, with the quickest ways to play anyway.
 * A block is never told apart: the server shows it as expired (ADR-053).
 */
function Ended({ title, copy, gameId, children = null }) {
  return (
    <section className={styles.page}>
      <PageTitle>{title}</PageTitle>
      <div className={styles.card}>
        <h1 className={styles.heading}>{title}</h1>
        <Bilingual copy={copy} />
        {children ?? <Bilingual copy={CHALLENGE_COPY.makeYourOwn} />}
        <div className={styles.actions}>
          <Link
            className={styles.primaryLink}
            to={gameId === undefined ? paths.home() : paths.game(gameId)}
            data-cc-control="challenge.new"
          >
            {gameId === undefined ? "Pick a game" : `Play ${gameName(gameId)}`}
          </Link>
          <Link to={paths.home()} data-cc-control="challenge.home">
            Back to the games
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The creator's own open challenge: the link to send, WhatsApp, and Take back. */
function Yours({ challenge, onChange }) {
  const { api } = useServices();
  const toast = useToast();
  const page = `${siteOrigin()}${paths.challenge(challenge.id)}`;
  const copied = withShareChannel(page, SHARE_CHANNELS.COPY);
  const game = gameName(challenge.gameId);
  const copy = useAction(
    async () => {
      try {
        await navigator.clipboard.writeText(copied);
      } catch (cause) {
        throw new Error("Couldn't copy. Select the link and copy it", { cause });
      }
      toast.show("Link copied", { tone: "success" });
    },
    { id: "challenge.copy" },
  );
  const withdraw = useAction(async () => onChange(await api.withdrawChallenge(challenge.id)), {
    id: "challenge.withdraw",
  });
  // An invite to one friend says who it waits for (CC-052). A link says whoever opens it first plays.
  const invite = challenge.toOne === true;
  const title = invite ? `Your ${game} invite` : `Your ${game} challenge`;
  return (
    <section className={styles.page}>
      <PageTitle>{title}</PageTitle>
      <div className={styles.card}>
        <InviteArt className={styles.art} />
        <h1 className={styles.heading}>
          <GameIcon gameId={challenge.gameId} className={styles.icon} />
          {title}
        </h1>
        <Bilingual
          copy={invite ? INVITE_COPY.yours(challenge.toName, game) : CHALLENGE_COPY.yoursIsOpen(game)}
        />
        <Bilingual copy={invite ? INVITE_COPY.lasts : CHALLENGE_COPY.lasts} />
        <p className={styles.time}>{hoursLeft(challenge.expiresAt)}</p>
        <label className={styles.label}>
          <span>Challenge link</span>
          <input readOnly value={copied} onFocus={(event) => event.target.select()} />
        </label>
        <div className={styles.actions}>
          <WhatsAppLink
            message={shareMessage({
              text: (invite ? friendInviteText : challengeText)({ gameId: challenge.gameId }),
              url: withShareChannel(page, SHARE_CHANNELS.WHATSAPP),
            })}
            control="challenge.whatsapp"
          />
          <Button control="challenge.copy" variant="secondary" action={copy} doneLabel="Copied">
            Copy link
          </Button>
          <Button control="challenge.withdraw" variant="ghost" action={withdraw}>
            Take back
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Someone else's open challenge: who sent it (by name only for an adult account, ADR-028.7) and Accept and play.
 * A visitor first chooses to play as a guest or to log in, as on a room link (CC-086), and nothing is made for them
 * until they choose.
 */
function Theirs({ challenge }) {
  const { api } = useServices();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { remember } = useChallengeInbox();
  const heading = useRef(null);
  const game = gameName(challenge.gameId);
  const visitor = session.status === "anonymous";
  // A visitor becomes a guest first. The page then reads the challenge again as that guest and offers Accept.
  const join = useAction(session.ensurePlayer, { id: "challenge.guest" });
  const accept = useAction(
    async () => {
      const taken = await api.acceptChallenge(challenge.id);
      remember(taken.challenge);
      navigate(paths.room(taken.room.gameId, taken.room.code), { replace: true });
    },
    { id: "challenge.accept" },
  );

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // An invite to one friend, opened by anyone else: a forwarded link. Its friend logs in to take it (CC-052).
  if (challenge.toOne === true && !challenge.forYou) {
    return (
      <Ended
        title="This invite is for someone else"
        copy={INVITE_COPY.forSomeoneElse}
        gameId={challenge.gameId}
      >
        {visitor && (
          <p className={styles.actions}>
            <Link to={paths.login(location.pathname)} data-cc-control="challenge.login">
              Log in
            </Link>
          </p>
        )}
      </Ended>
    );
  }

  return (
    <section className={styles.page}>
      <PageTitle>{`${game} challenge`}</PageTitle>
      <div className={styles.card}>
        <InviteArt className={styles.art} />
        <h1 ref={heading} tabIndex={-1} className={styles.heading}>
          <GameIcon gameId={challenge.gameId} className={styles.icon} />
          You've been challenged to {game}
        </h1>
        <Bilingual copy={CHALLENGE_COPY.challengesYou(challenge.fromName, game)} />
        <p className={styles.time}>{hoursLeft(challenge.expiresAt)}</p>
        {visitor && <Bilingual copy={CHALLENGE_COPY.signInFirst} />}
        <div className={styles.actions}>
          {visitor ? (
            <Button control="challenge.guest" size="lg" action={join}>
              Play as guest
            </Button>
          ) : (
            <Button control="challenge.accept" size="lg" action={accept}>
              Accept and play
            </Button>
          )}
          {visitor ? (
            <>
              <Link to={paths.login(location.pathname)} data-cc-control="challenge.login">
                Log in
              </Link>
              <Link to={paths.signup(location.pathname)} data-cc-control="challenge.signup">
                Sign up
              </Link>
            </>
          ) : (
            <Link to={paths.home()} data-cc-control="challenge.not_now">
              Not now
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

/** A challenge someone took: the way into its room for its creator and the taker, and "taken" for anyone else. */
function Taken({ challenge }) {
  if (challenge.room === undefined) {
    return <Ended title="Challenge taken" copy={CHALLENGE_COPY.taken} gameId={challenge.gameId} />;
  }
  const game = gameName(challenge.gameId);
  return (
    <section className={styles.page}>
      <PageTitle>Challenge taken</PageTitle>
      <div className={styles.card}>
        <h1 className={styles.heading}>Challenge taken</h1>
        <Bilingual
          copy={
            challenge.own ? CHALLENGE_COPY.tookYours(challenge.acceptedName, game) : CHALLENGE_COPY.tookIt
          }
        />
        <div className={styles.actions}>
          <Link
            className={styles.primaryLink}
            to={paths.room(challenge.room.gameId, challenge.room.code)}
            data-cc-control="challenge.play"
          >
            Go to the game
          </Link>
        </div>
      </div>
    </section>
  );
}

/** An invite of the player's that their friend declined or never answered: the same words for both (CC-052). */
function NotRightNow({ challenge }) {
  return (
    <Ended
      title="Not right now"
      copy={CHALLENGE_COPY.notRightNow(challenge.toName)}
      gameId={challenge.gameId}
    />
  );
}

/**
 * An invite to the player that another friend took first (CC-052 scenario 6): Game filled, and Invite again, which
 * invites its sender back to the same game.
 */
function GameFilled({ challenge }) {
  const { api } = useServices();
  const navigate = useNavigate();
  const { remember } = useChallengeInbox();
  const invites = useFlag("friend_invites");
  const again = useAction(
    async () => {
      const back = await api.inviteAgain(challenge.id);
      remember(back);
      navigate(paths.challenge(back.id));
    },
    { id: "challenge.invite_again" },
  );
  return (
    <Ended title="Game filled" copy={INVITE_COPY.gameFilled(challenge.fromName)} gameId={challenge.gameId}>
      {invites && (
        <div className={styles.actions}>
          <Button control="challenge.invite_again" action={again}>
            {`Invite ${challenge.fromName} again`}
          </Button>
        </div>
      )}
    </Ended>
  );
}

/**
 * A challenge's own page at `/challenge/:id` (CC-139, ADR-069), the link sent on WhatsApp. Its creator sees the link
 * to send and Take back. Anyone else sees who challenged them and Accept and play, which makes a room for both and
 * goes there. A challenge that is over, or an address that leads nowhere, gets an honest page with the way to play.
 */
export function ChallengePage() {
  const { id } = useParams();
  const view = useChallenge(String(id));

  if (view.status === "loading") {
    return (
      <section className={styles.page}>
        <PageTitle>Challenge</PageTitle>
        <p aria-busy="true">Opening the challenge…</p>
      </section>
    );
  }
  if (view.status === "notFound") {
    return <Ended title="Challenge not found" copy={CHALLENGE_COPY.notFound} />;
  }
  if (view.status === "error") {
    return (
      <section className={styles.page}>
        <PageTitle>Challenge</PageTitle>
        <h1>Couldn't open this challenge</h1>
        <p>{view.error.message}</p>
        <Button control="challenge.retry" onClick={view.retry}>
          Try again
        </Button>
      </section>
    );
  }
  const { challenge } = view;
  switch (challenge.state) {
    case CHALLENGE_STATES.OPEN:
      return challenge.own ? (
        <Yours challenge={challenge} onChange={view.show} />
      ) : (
        <Theirs challenge={challenge} />
      );
    case CHALLENGE_STATES.ACCEPTED:
      return <Taken challenge={challenge} />;
    case CHALLENGE_STATES.EXPIRED:
      // The sender of an invite reads the same for no answer as for a decline, and so for a block (CC-052).
      return challenge.own && challenge.toOne === true ? (
        <NotRightNow challenge={challenge} />
      ) : (
        <Ended title="Challenge expired" copy={CHALLENGE_COPY.expired} gameId={challenge.gameId} />
      );
    case CHALLENGE_STATES.DECLINED:
      return challenge.own ? (
        <NotRightNow challenge={challenge} />
      ) : (
        <Ended title="Challenge over" copy={CHALLENGE_COPY.over} gameId={challenge.gameId} />
      );
    case CHALLENGE_STATES.FILLED:
      return <GameFilled challenge={challenge} />;
    case CHALLENGE_STATES.WITHDRAWN:
      return <Ended title="Challenge taken back" copy={CHALLENGE_COPY.withdrawn} gameId={challenge.gameId} />;
    default:
      return (
        <Ended
          title="Challenge over"
          copy={challenge.own ? CHALLENGE_COPY.notRightNow(challenge.toName) : CHALLENGE_COPY.over}
          gameId={challenge.gameId}
        />
      );
  }
}
