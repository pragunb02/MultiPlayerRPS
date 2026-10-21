import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { CHALLENGE_STATES, getGame, SHARE_CHANNELS } from "@classicade/shared";
import { paths, withShareChannel } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { siteOrigin } from "../../app/siteOrigin.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { InviteArt } from "../../art/illustrations/InviteArt.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { Card, CardMedia } from "../../components/Card/Card.jsx";
import { CHALLENGE_COPY } from "../../components/Challenges/challengeCopy.js";
import { useChallengeInbox } from "../../components/Challenges/challengesContext.js";
import { Field } from "../../components/Field/Field.jsx";
import { PageHeader } from "../../components/Page/Page.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Bilingual } from "../../components/Profile/Bilingual.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { WhatsAppLink } from "../../components/WhatsAppLink/WhatsAppLink.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useChallenge } from "../../hooks/useChallenge.js";
import { useSession } from "../../hooks/useSession.js";
import { challengeText, shareMessage } from "../../lib/shareText.js";
import { NO_INTERRUPTIONS } from "../../lib/telemetry/interruptions.js";
import styles from "./ChallengePage.module.css";

const HOUR_MS = 60 * 60 * 1000;
const gameName = (gameId) => getGame(gameId)?.name ?? "a game";

/** "Open for 23 more hours", rounded up, so it never says 0 while the link still works. */
const hoursLeft = (expiresAt) => {
  const hours = Math.max(1, Math.ceil((expiresAt - Date.now()) / HOUR_MS));
  return `Open for ${hours} more ${hours === 1 ? "hour" : "hours"}.`;
};

/** The invitation art across the top of a challenge's card, edge to edge. */
function InviteMedia() {
  return (
    <CardMedia className={styles.media}>
      <InviteArt className={styles.art} />
    </CardMedia>
  );
}

/**
 * A challenge that is over, or a link that leads nowhere: the shared dead end (CC-323), honest about why, with the
 * quickest way to play anyway. A block is never told apart: the server shows it as expired (ADR-053).
 */
function Ended({ title, copy, gameId }) {
  return (
    <section className={styles.page}>
      <PageTitle>{title}</PageTitle>
      <EmptyState
        title={title}
        headingLevel={1}
        art={<InviteArt />}
        action={
          <Button
            as="link"
            to={gameId === undefined ? paths.home() : paths.game(gameId)}
            control="challenge.new"
          >
            {gameId === undefined ? "Pick a game" : `Play ${gameName(gameId)}`}
          </Button>
        }
        secondary={
          <Button as="link" to={paths.home()} control="challenge.home" variant="ghost">
            Back to the games
          </Button>
        }
      >
        <Bilingual copy={copy} as="span" /> <Bilingual copy={CHALLENGE_COPY.makeYourOwn} as="span" />
      </EmptyState>
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
  const withdraw = useAction(async () => onChange(await api.withdrawChallenge(challenge.id)), {
    id: "challenge.withdraw",
  });
  return (
    <section className={styles.page}>
      <PageTitle>{`Your ${game} challenge`}</PageTitle>
      <Card as="div" variant="accent" tone="primary">
        <InviteMedia />
        <h1 className={styles.heading}>
          <GameIcon gameId={challenge.gameId} className={styles.icon} />
          Your {game} challenge
        </h1>
        <Bilingual copy={CHALLENGE_COPY.yoursIsOpen(game)} />
        <Bilingual copy={CHALLENGE_COPY.lasts} />
        <p className={styles.time}>{hoursLeft(challenge.expiresAt)}</p>
        <Field
          label="Challenge link"
          kind="copy"
          value={copied}
          control="challenge.copy"
          copyLabel="Copy link"
          copyFailure="Couldn't copy. Select the link and copy it"
          onCopied={() => toast.show("Link copied", { surface: "toast.copied", tone: "success" })}
        />
        <div className={styles.actions}>
          <WhatsAppLink
            message={shareMessage({
              text: challengeText({ gameId: challenge.gameId }),
              url: withShareChannel(page, SHARE_CHANNELS.WHATSAPP),
            })}
            control="challenge.whatsapp"
          />
          <Button control="challenge.withdraw" variant="ghost" action={withdraw}>
            Take back
          </Button>
        </div>
      </Card>
    </section>
  );
}

/**
 * Someone else's open challenge: who sent it (by name only for an adult account, ADR-028.7) and Accept and play.
 * A visitor first chooses to play as a guest or to log in, as on a room link (CC-086), and nothing is made for them
 * until they choose. The heading takes the focus for a screen reader, and as it is not a control it draws no ring.
 */
function Theirs({ challenge }) {
  const { api, interruptions = NO_INTERRUPTIONS } = useServices();
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
      interruptions.reach("challenge", "challenge_accepted");
      remember(taken.challenge);
      navigate(paths.room(taken.room.gameId, taken.room.code), { replace: true });
    },
    { id: "challenge.accept" },
  );

  useEffect(() => {
    heading.current.focus();
  }, []);

  return (
    <section className={styles.page}>
      <PageTitle>{`${game} challenge`}</PageTitle>
      <Card as="div" variant="accent" tone="primary">
        <InviteMedia />
        <h1 ref={heading} tabIndex={-1} className={styles.heading}>
          <GameIcon gameId={challenge.gameId} className={styles.icon} />
          You've been challenged to {game}
        </h1>
        <Bilingual copy={CHALLENGE_COPY.challengesYou(challenge.fromName, game)} />
        <p className={styles.time}>{hoursLeft(challenge.expiresAt)}</p>
        {visitor && <Bilingual copy={CHALLENGE_COPY.signInFirst} />}
        <div className={styles.actions}>
          {visitor ? (
            <>
              <Button control="challenge.guest" size="lg" action={join}>
                Play as guest
              </Button>
              <Button
                as="link"
                to={paths.login(location.pathname)}
                control="challenge.login"
                variant="secondary"
              >
                Log in
              </Button>
              <Button
                as="link"
                to={paths.signup(location.pathname)}
                control="challenge.signup"
                variant="ghost"
              >
                Sign up
              </Button>
            </>
          ) : (
            <>
              <Button control="challenge.accept" size="lg" action={accept}>
                Accept and play
              </Button>
              <Button as="link" to={paths.home()} control="challenge.not_now" variant="ghost">
                Not now
              </Button>
            </>
          )}
        </div>
      </Card>
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
      <Card as="div" variant="accent" tone="primary">
        <h1 className={styles.heading}>Challenge taken</h1>
        <Bilingual
          copy={
            challenge.own ? CHALLENGE_COPY.tookYours(challenge.acceptedName, game) : CHALLENGE_COPY.tookIt
          }
        />
        <div className={styles.actions}>
          <Button
            as="link"
            to={paths.room(challenge.room.gameId, challenge.room.code)}
            control="challenge.play"
            size="lg"
          >
            Go to the game
          </Button>
        </div>
      </Card>
    </section>
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
        <Skeleton label="Opening the challenge…" shape="card" />
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
        <PageHeader title="Couldn't open this challenge" />
        <ErrorState title={view.error.message} control="challenge" onRetry={view.retry} />
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
      return <Ended title="Challenge expired" copy={CHALLENGE_COPY.expired} gameId={challenge.gameId} />;
    case CHALLENGE_STATES.WITHDRAWN:
      return <Ended title="Challenge taken back" copy={CHALLENGE_COPY.withdrawn} gameId={challenge.gameId} />;
    default:
      return (
        <Ended
          title="Challenge over"
          copy={challenge.own ? CHALLENGE_COPY.declinedYours(challenge.toName) : CHALLENGE_COPY.over}
          gameId={challenge.gameId}
        />
      );
  }
}
