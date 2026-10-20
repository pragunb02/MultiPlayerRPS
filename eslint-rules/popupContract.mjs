/**
 * The pop-up rule of the design contract (docs/design/CONTRACT.md, CC-314). A pop-up is anything that draws over
 * the page or speaks in a live region: a portal, a dialog role, an `aria-live` region, or a fixed position in CSS.
 * Only the components the contract names may make one, so a new kind of pop-up needs a change to the contract
 * first. The `classicade/popup-contract` ESLint rule checks the JavaScript, and the CSS token check
 * (scripts/design/cssTokens.mjs) checks `position: fixed`.
 */

/** Where the rules are written. Every message points there. */
export const CONTRACT_FILE = "docs/design/CONTRACT.md";

/** The kinds of pop-up the contract allows. */
export const POPUP_KINDS = Object.freeze({
  DIALOG: "dialog",
  TOAST: "toast",
  BANNER: "banner",
  CELEBRATION: "celebration",
  ANNOUNCER: "announcer",
  BOARD_PICKER: "board picker",
});

const entry = (path, kind, reason) => Object.freeze({ path, kind, reason });

/**
 * The files allowed to make a pop-up, each with its kind and why. This list may only shrink: the contract lists the
 * same files, and a test fails when the two differ, so a new entry needs a contract change in the same pull request.
 */
export const POPUP_COMPONENTS = Object.freeze([
  entry(
    "apps/web/src/components/Modal/Modal.jsx",
    POPUP_KINDS.DIALOG,
    "The one dialog: a portal with a dialog role.",
  ),
  entry("apps/web/src/components/Modal/Modal.module.css", POPUP_KINDS.DIALOG, "The dialog's fixed backdrop."),
  entry(
    "apps/web/src/components/Toast/ToastProvider.jsx",
    POPUP_KINDS.TOAST,
    "The one polite live region of toasts.",
  ),
  entry("apps/web/src/components/Toast/Toast.module.css", POPUP_KINDS.TOAST, "The fixed toast column."),
  entry(
    "apps/web/src/components/GamificationToasts.jsx",
    POPUP_KINDS.TOAST,
    "Reward toasts drawn on the body.",
  ),
  entry("apps/web/src/components/GamificationToasts.module.css", POPUP_KINDS.TOAST, "The rising quest XP."),
  entry(
    "apps/web/src/components/ProgressToasts.jsx",
    POPUP_KINDS.CELEBRATION,
    "The level-up burst on the body.",
  ),
  entry(
    "apps/web/src/components/Celebrations/ResultCelebration.jsx",
    POPUP_KINDS.CELEBRATION,
    "Confetti after a win, drawn on the body.",
  ),
  entry(
    "apps/web/src/art/effects/effects.module.css",
    POPUP_KINDS.CELEBRATION,
    "The fixed celebration overlay.",
  ),
  entry(
    "apps/web/src/components/TurnBanner/TurnBanner.jsx",
    POPUP_KINDS.BANNER,
    "Whose turn it is, read out.",
  ),
  entry(
    "apps/web/src/components/PageAnnouncer/PageAnnouncer.jsx",
    POPUP_KINDS.ANNOUNCER,
    "Reads out a new page.",
  ),
  entry(
    "apps/web/src/components/MatchShell/MatchAnnouncer.jsx",
    POPUP_KINDS.ANNOUNCER,
    "Reads out moves and results.",
  ),
  entry("apps/web/src/components/Layout/Layout.jsx", POPUP_KINDS.ANNOUNCER, "Reads out a sign-in change."),
  entry(
    "apps/web/src/components/PlayComputer/PlayComputer.jsx",
    POPUP_KINDS.ANNOUNCER,
    "Reads out the chosen level.",
  ),
  entry(
    "apps/web/src/games/chess/ChessBoard.jsx",
    POPUP_KINDS.ANNOUNCER,
    "Reads out the last move and a low clock.",
  ),
  entry(
    "apps/web/src/pages/AdminPage/AdminRoute.jsx",
    POPUP_KINDS.ANNOUNCER,
    "Reads out that the console loads.",
  ),
  entry(
    "apps/web/src/pages/DailyPuzzlePage/DailyPuzzlePage.jsx",
    POPUP_KINDS.ANNOUNCER,
    "Reads out puzzle moves.",
  ),
  entry(
    "apps/web/src/games/chess/PromotionPicker.jsx",
    POPUP_KINDS.BOARD_PICKER,
    "The promotion choice, inside the board.",
  ),
]);

const normalised = (file) => file.replaceAll("\\", "/");

/**
 * Whether a file is one of the contract's pop-up components.
 *
 * @param {string} file  an absolute path or one from the repository root
 * @returns {boolean}
 */
export const isPopupComponent = (file) =>
  POPUP_COMPONENTS.some(({ path }) => normalised(file) === path || normalised(file).endsWith(`/${path}`));

const POPUP_ROLES = new Set(["dialog", "alertdialog"]);

/** The text of a JSX attribute written as a plain string, `"x"` or `{"x"}`. Anything worked out at run time is empty. */
const literalOf = (attribute) => {
  const { value } = attribute;
  if (value?.type === "Literal") return String(value.value);
  if (value?.type === "JSXExpressionContainer" && value.expression.type === "Literal") {
    return String(value.expression.value);
  }
  return "";
};

/**
 * The `classicade/popup-contract` rule. It refuses a portal, a dialog or alert dialog role, and a live region
 * outside the contract's components. `aria-live="off"` is not a live region, so it is allowed.
 * @type {import("eslint").Rule.RuleModule}
 */
export const popupContractRule = Object.freeze({
  meta: {
    type: "problem",
    docs: { description: `Only the design contract's components may make a pop-up (${CONTRACT_FILE}).` },
    schema: [],
    messages: {
      popup:
        "{{ found }} makes a new pop-up. Use the contract's Modal, a toast or a banner instead, or change " +
        `${CONTRACT_FILE} first and add this file to POPUP_COMPONENTS in eslint-rules/popupContract.mjs.`,
    },
  },
  create(context) {
    if (isPopupComponent(context.filename)) return {};
    const report = (node, found) => context.report({ node, messageId: "popup", data: { found } });
    return {
      CallExpression(node) {
        const { callee } = node;
        const name = callee.type === "MemberExpression" ? callee.property.name : callee.name;
        if (name === "createPortal") report(node, "createPortal");
      },
      JSXAttribute(node) {
        const name = node.name.name;
        const value = literalOf(node);
        if (name === "role" && POPUP_ROLES.has(value)) report(node, `role="${value}"`);
        if (name === "aria-live" && value !== "off") report(node, "aria-live");
      },
    };
  },
});
