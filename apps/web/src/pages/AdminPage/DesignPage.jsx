import { useState } from "react";
import { Link } from "react-router";
import { SITE_NAME } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { TurnBanner } from "../../components/TurnBanner/TurnBanner.jsx";
import { useFlag } from "../../hooks/useFlag.js";
import { contrastRatio } from "../../styles/contrast.js";
import {
  BRAND_COLOURS,
  BREAKPOINTS,
  colourTokensOf,
  ELEVATIONS,
  LAYERS,
  LEADING_ROLES,
  PLAYER_ROLES,
  STATUS_ROLES,
  TYPE_ROLES,
  WEIGHTS,
} from "../../styles/tokenRoles.js";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
import {
  ButtonStates,
  CardStates,
  FieldStates,
  RegionStates,
  SectionPatterns,
  TabStates,
} from "./DesignComponents.jsx";
import consoleStyles from "./AdminPage.module.css";
import styles from "./DesignPage.module.css";

/** A token's value in the theme the device shows now, as the browser worked it out. */
const tokenValue = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A contrast ratio to one decimal place, or a dash when either colour cannot be read (such as in a test). */
function ratio(first, second) {
  try {
    return `${contrastRatio(tokenValue(first), tokenValue(second)).toFixed(1)}:1`;
  } catch {
    return "–";
  }
}

const darkTheme = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** The player names on this page are made up (CC-314 privacy checklist). */
const SEATS = Object.freeze([
  Object.freeze({ playerId: "riya", displayName: "Riya" }),
  Object.freeze({ playerId: "guest", displayName: "Guest-ABCD" }),
]);
const turnRoom = (you, active) => ({
  you,
  status: "playing",
  seats: SEATS,
  game: { activePlayers: [active] },
});

function ColourRoles() {
  return (
    <section aria-labelledby="design-colours">
      <h2 id="design-colours">Colour roles</h2>
      <p className={styles.note}>
        Each solid colour needs 4.5:1 on the page, on a card and on its own pale background, and its text
        colour needs 4.5:1 on it. Never colour alone: always a word too.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Solid and its text</th>
            <th scope="col">Pale background</th>
            <th scope="col">On the page</th>
            <th scope="col">On a card</th>
            <th scope="col">On its pale background</th>
            <th scope="col">Its text on it</th>
          </tr>
        </thead>
        <tbody>
          {[...STATUS_ROLES, ...PLAYER_ROLES].map(({ role, use }) => {
            const { solid, soft, on } = colourTokensOf(role);
            return (
              <tr key={role} data-cc-role={role}>
                <th scope="row">
                  <code>{solid}</code>
                  <span className={styles.use}>{use}</span>
                </th>
                <td>
                  <span className={`${styles.swatch} ${styles.solid} ${styles[role]}`}>{role}</span>
                </td>
                <td>
                  <span className={`${styles.swatch} ${styles.soft} ${styles[role]}`}>{role}</span>
                </td>
                <td>{ratio(solid, "--color-bg")}</td>
                <td>{ratio(solid, "--color-surface")}</td>
                <td>{ratio(solid, soft)}</td>
                <td>{ratio(on, solid)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Brand: decoration and identity, never status</h3>
      <ul className={styles.brand}>
        {BRAND_COLOURS.map((token) => (
          <li key={token}>
            <span className={`${styles.dot} ${styles[token.slice("--color-".length)]}`} aria-hidden="true" />
            <code>{token}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TypeAndElevation() {
  return (
    <section aria-labelledby="design-type">
      <h2 id="design-type">Type, weight, breakpoints, elevation and layers</h2>
      <ul className={styles.stack}>
        {[...TYPE_ROLES, ...LEADING_ROLES].map(({ token, use }) => (
          <li key={token}>
            <p className={styles[token.slice(2)]}>The quick move wins the round</p>
            <code>{token}</code> <span className={styles.use}>{use}</span>
          </li>
        ))}
      </ul>
      <ul className={styles.stack}>
        {WEIGHTS.map(({ token, use }) => (
          <li key={token}>
            <p className={styles[token.slice(2)]}>The quick move wins the round</p>
            <code>{token}</code> <span className={styles.use}>{use}</span>
          </li>
        ))}
      </ul>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Breakpoint</th>
            <th scope="col">Width</th>
            <th scope="col">Use</th>
          </tr>
        </thead>
        <tbody>
          {BREAKPOINTS.map(({ token, use }) => (
            <tr key={token}>
              <th scope="row">
                <code>{token}</code>
              </th>
              <td>{tokenValue(token) || "–"}</td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={styles.cards}>
        {ELEVATIONS.map(({ token, use }) => (
          <li key={token} className={`${styles.card} ${styles[token.slice(2)]}`}>
            <code>{token}</code>
            <span className={styles.use}>{use}</span>
          </li>
        ))}
      </ul>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Layer, lowest first</th>
            <th scope="col">Value</th>
            <th scope="col">Use</th>
          </tr>
        </thead>
        <tbody>
          {LAYERS.map(({ token, value, use }) => (
            <tr key={token}>
              <th scope="row">
                <code>{token}</code>
              </th>
              <td>{value}</td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Pops() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { api } = useServices();
  const openDialog = () => {
    setOpen(true);
    // The flag's success event: the owner tried a real component on this page.
    api.sendFlagSuccess("design_page").catch(() => undefined);
  };
  return (
    <>
      <div className={styles.example} data-cc-component="dialog">
        <h3>Dialog</h3>
        <Button control="admin.design.dialog" variant="secondary" onClick={openDialog}>
          Open a dialog
        </Button>
        <Modal
          surface="dialog.design_sample"
          open={open}
          destructive
          title="Block Riya?"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button control="admin.design.dialog.cancel" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button control="admin.design.dialog.confirm" variant="danger" onClick={() => setOpen(false)}>
                Block
              </Button>
            </>
          }
        >
          <p>You won&apos;t be put in a room with Riya again. Riya is not told.</p>
        </Modal>
      </div>
      <div className={styles.example} data-cc-component="toast">
        <h3>Toast</h3>
        <Button
          control="admin.design.toast"
          variant="secondary"
          onClick={() =>
            toast.show("Saved. This is a toast.", { surface: "toast.design_sample", tone: "success" })
          }
        >
          Show a toast
        </Button>
      </div>
      <div className={styles.example} data-cc-component="banner">
        <h3>Banner</h3>
        <div className={styles.stack}>
          <TurnBanner room={turnRoom("riya", "riya")} />
          <TurnBanner room={turnRoom("riya", "guest")} />
          <TurnBanner room={turnRoom("", "riya")} />
        </div>
      </div>
    </>
  );
}

function StaticParts() {
  return (
    <>
      <div className={styles.example} data-cc-component="badge">
        <h3>Badge</h3>
        <p className={styles.row}>
          <span className={styles.badge}>New</span>
          <span className={`${styles.badge} ${styles.badgeSuccess}`}>Saved</span>
          <span className={`${styles.badge} ${styles.badgeCount}`} aria-label="3 unread">
            3
          </span>
        </p>
      </div>
    </>
  );
}

function Contract() {
  return (
    <>
      <p className={styles.note} data-cc-theme={darkTheme() ? "dark" : "light"}>
        Shown in the {darkTheme() ? "dark" : "light"} theme, as your device is set. Switch your device&apos;s
        theme to check the other one. The rules are in <code>docs/design/CONTRACT.md</code>.
      </p>
      <ColourRoles />
      <TypeAndElevation />
      <section aria-labelledby="design-components">
        <h2 id="design-components">Components</h2>
        <ButtonStates />
        <Pops />
        <CardStates />
        <StaticParts />
        <RegionStates />
        <FieldStates />
        <TabStates />
        <SectionPatterns />
      </section>
    </>
  );
}

/**
 * The console's living design contract (CC-314): every token of docs/design/CONTRACT.md and the app's real
 * components in their states, drawn with the real tokens.css, so it cannot drift from the app. It shows only made
 * up names and no player data. Only an admin reaches it (AdminRoute), and it sits behind the `design_page` flag.
 */
export function DesignPage() {
  const on = useFlag("design_page");
  return (
    <section className={consoleStyles.page} aria-labelledby="design-title">
      <title>{`Design · Owner console · ${SITE_NAME}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className={consoleStyles.header}>
        <h1 id="design-title">Design</h1>
        <p className={consoleStyles.lede}>
          The design contract, drawn with the app&apos;s own tokens and components. Builders pick from here,
          and reviewers point at it.
        </p>
      </header>
      <ConsoleTabs current="design" />
      {on ? (
        <Contract />
      ) : (
        <p className={consoleStyles.status}>
          This page is behind the design_page flag, which is off for you. Turn it on from the{" "}
          <Link to={paths.adminFlags()}>Flags</Link> page.
        </p>
      )}
    </section>
  );
}
