import { useEffect } from "react";
import { GameArt } from "../../art/games/GameArt.jsx";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { GameOver404 } from "../../art/illustrations/GameOver404.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { Card, CardBody, CardFooter, CardHeader, CardLink, CardMedia } from "../../components/Card/Card.jsx";
import { Field } from "../../components/Field/Field.jsx";
import {
  ACCENT_TONES,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  NOTICE_TONES,
  SKELETON_SHAPES,
} from "../../components/looks.js";
import { Section, Sections } from "../../components/Page/Page.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
import { Tabs } from "../../components/Tabs/Tabs.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { useAction } from "../../hooks/useAction.js";
import styles from "./DesignPage.module.css";

/** Waits a moment and then answers, so the waiting state shows. */
const later = (ms, outcome) =>
  new Promise((resolve, reject) => setTimeout(() => outcome(resolve, reject), ms));

/** The words each look is for, as the contract says. */
const VARIANT_USE = Object.freeze({
  primary: "The one main next step of a region.",
  accent: "The primary's look on the hero art.",
  secondary: "Any other action.",
  ghost: "A quiet action, such as Leave or Not now.",
  danger: "Only where the player may lose something they made.",
});

/** A small arrow drawn for the icon examples. Decoration: the button's label names it. */
const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Every button look, size and state of the contract (CC-164, CC-323). */
export function ButtonStates() {
  const waits = useAction(() => later(1_200, (resolve) => resolve()), { id: "admin.design.waiting" });
  const fails = useAction(() => later(0, (_, reject) => reject(new Error("The server did not answer."))), {
    id: "admin.design.failed",
  });
  // Always waiting, so the loading state is on the page without a press.
  const loading = useAction(() => new Promise(() => {}), { id: "admin.design.loading" });
  const { run } = loading;
  useEffect(() => {
    run();
  }, [run]);
  return (
    <div className={styles.example} data-cc-component="button">
      <h3>Button</h3>
      <p className={styles.note}>
        One primary per region: a page, a dialog, a card or a sheet. Hover, focus with Tab, and press each
        one.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Look</th>
            {BUTTON_SIZES.map((size) => (
              <th scope="col" key={size}>
                {size}
              </th>
            ))}
            <th scope="col">Cannot act, with its reason</th>
          </tr>
        </thead>
        <tbody>
          {BUTTON_VARIANTS.map((variant) => (
            <tr key={variant} data-cc-variant-row={variant}>
              <th scope="row">
                <code>{variant}</code>
                <span className={styles.use}>{VARIANT_USE[variant]}</span>
              </th>
              {BUTTON_SIZES.map((size) => (
                <td key={size}>
                  <Button control={`admin.design.${variant}.${size}`} variant={variant} size={size}>
                    Play now
                  </Button>
                </td>
              ))}
              <td>
                <Button
                  control={`admin.design.${variant}.reason`}
                  variant={variant}
                  reason="Wait for your turn."
                >
                  Resign
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>States</h4>
      <div className={styles.row}>
        <Button control="admin.design.loading" variant="secondary" action={loading}>
          Loading
        </Button>
        <Button control="admin.design.waiting" variant="secondary" action={waits} doneLabel="Sent">
          Press to see waiting
        </Button>
        <Button control="admin.design.failed" variant="secondary" action={fails}>
          Press to see failed
        </Button>
      </div>
      <h4>Link form and icons</h4>
      <div className={styles.row}>
        <Button as="link" to="/admin/design" control="admin.design.link" variant="secondary">
          A link drawn as a button
        </Button>
        <Button control="admin.design.icon" variant="secondary" icon={<Arrow />}>
          Next
        </Button>
        <Button control="admin.design.icon_only" variant="ghost" icon={<Arrow />} label="Next round" />
      </div>
    </div>
  );
}

/** Every card look and state (CC-323). */
export function CardStates() {
  return (
    <div className={styles.example} data-cc-component="card">
      <h3>Card</h3>
      <p className={styles.note}>
        A clickable card has one link, stretched over it. Hover lifts it and adds the brand glow. A game tone
        marks that game, and a brand or gold accent marks the one featured card of a screen.
      </p>
      <ul className={styles.cards}>
        <Card as="li" interactive variant="accent" tone="chess" aria-labelledby="design-card-interactive">
          <CardMedia>
            <GameArt gameId="chess" />
          </CardMedia>
          <CardHeader
            id="design-card-interactive"
            title={
              <CardLink to="/admin/design" control="admin.design.card.link">
                Chess
              </CardLink>
            }
            description="Interactive, with art to its edges."
          />
        </Card>
        <Card as="li" aria-labelledby="design-card-surface">
          <CardHeader id="design-card-surface" title="Surface" description="At rest on the page." />
          <CardBody>
            <p className={styles.note}>The default card.</p>
          </CardBody>
          <CardFooter>
            <Button control="admin.design.card" variant="secondary" size="sm">
              Open
            </Button>
          </CardFooter>
        </Card>
        <Card as="li" variant="raised" aria-labelledby="design-card-raised">
          <CardHeader id="design-card-raised" title="Raised" description="A panel above the page." />
        </Card>
        <Card as="li" selected aria-labelledby="design-card-selected">
          <CardHeader id="design-card-selected" title="Selected" description="The chosen one of a set." />
        </Card>
        <Card as="li" interactive reason="Sign in to play ranked." aria-labelledby="design-card-reason">
          <CardHeader id="design-card-reason" title="Cannot act" description="Dimmed, with its reason." />
        </Card>
        {ACCENT_TONES.map((tone) => (
          <Card as="li" key={tone} variant="accent" tone={tone} aria-labelledby={`design-accent-${tone}`}>
            <CardHeader id={`design-accent-${tone}`} title={`Accent ${tone}`} titleAs="h4" />
          </Card>
        ))}
        {NOTICE_TONES.map((tone) => (
          <Card as="li" key={tone} variant="notice" tone={tone} aria-labelledby={`design-notice-${tone}`}>
            <CardHeader id={`design-notice-${tone}`} title={`Notice: ${tone}`} titleAs="h4" />
            <p className={styles.note}>A notice always says what it means in words.</p>
          </Card>
        ))}
      </ul>
    </div>
  );
}

/** The empty, error and loading states (CC-323). */
export function RegionStates() {
  return (
    <>
      <div className={styles.example} data-cc-component="empty state">
        <h3>Empty state</h3>
        <EmptyState
          title="No friends yet"
          art={<GameOver404 title="" />}
          action={
            <Button control="admin.design.empty" size="md">
              Add a friend
            </Button>
          }
        >
          Friends you add show up here, with who is online.
        </EmptyState>
      </div>
      <div className={styles.example} data-cc-component="error state">
        <h3>Error state</h3>
        <ErrorState title="Couldn't load the leaderboard." control="admin.design.error" onRetry={() => {}}>
          Check your connection, then try again.
        </ErrorState>
      </div>
      <div className={styles.example} data-cc-component="skeleton">
        <h3>Skeleton</h3>
        <p className={styles.note}>Each shape takes the room of what it stands in for, so nothing jumps.</p>
        <div className={styles.stack}>
          {SKELETON_SHAPES.filter((shape) => shape !== "board" && shape !== "block").map((shape) => (
            <div key={shape}>
              <code>{shape}</code>
              <Skeleton
                label={`Loading the ${shape} example`}
                shape={shape}
                count={shape === "row" ? 2 : 1}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Every kind of form field with a label, hint, error and count (CC-323). */
export function FieldStates() {
  const toast = useToast();
  return (
    <div className={styles.example} data-cc-component="field">
      <h3>Field</h3>
      <div className={styles.fields}>
        <Field label="Username" hint="3 to 20 letters, digits or _." />
        <Field label="Email" type="email" error="That email can't be used." defaultValue="riya@example" />
        <Field label="Message" kind="textarea" maxLength={500} hint="What happened, in a line or two." />
        <Field label="Match length" kind="select" defaultValue="3">
          <option value="1">Best of 1</option>
          <option value="3">Best of 3</option>
          <option value="5">Best of 5</option>
        </Field>
        <Field label="From" kind="date" defaultValue="2026-10-14" />
        <Field
          label="Challenge link"
          kind="copy"
          value="https://example.com/challenge/demo"
          control="admin.design.copy"
          copyLabel="Copy link"
          onCopied={() => toast.show("Link copied", { surface: "toast.copied", tone: "success" })}
        />
        <Field label="Room code" disabled hint="Opens once the room is ready." />
      </div>
    </div>
  );
}

/** The one set of tabs (CC-323). */
export function TabStates() {
  return (
    <div className={styles.example} data-cc-component="tabs">
      <h3>Tabs</h3>
      <Tabs
        label="Example boards"
        control="admin.design.tab"
        current="overall"
        items={[
          { id: "overall", label: "Overall", to: "/admin/design" },
          { id: "weekly", label: "This week", to: "/admin/design" },
          { id: "chess", label: "Chess", to: "/admin/design", icon: <GameIcon gameId="chess" /> },
        ]}
      />
    </div>
  );
}

/**
 * The owner's rules for dense pages (CC-323): titled sections, colour with meaning and a word, data with its unit,
 * window and empty state, numbers aligned under a header row.
 */
export function SectionPatterns() {
  return (
    <div className={styles.example} data-cc-component="section">
      <h3>Sections and data</h3>
      <Sections>
        <Section title="Games played" description="Finished games, last 7 days, India time.">
          <table className={styles.data}>
            <thead>
              <tr>
                <th scope="col">Game</th>
                <th scope="col" className={styles.number}>
                  Games
                </th>
                <th scope="col" className={styles.number}>
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Chess</th>
                <td className={styles.number}>1,204</td>
                <td className={`${styles.number} ${styles.up}`}>▲ 12% up</td>
              </tr>
              <tr>
                <th scope="row">Tic Tac Toe</th>
                <td className={styles.number}>86</td>
                <td className={`${styles.number} ${styles.down}`}>▼ 3% down</td>
              </tr>
            </tbody>
          </table>
        </Section>
        <Section title="Feedback" description="New reports, last 30 days.">
          <EmptyState title="Nothing new" headingLevel={3}>
            New reports from players show up here.
          </EmptyState>
        </Section>
      </Sections>
    </div>
  );
}
