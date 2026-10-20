/**
 * The token roles of the design contract (docs/design/CONTRACT.md, CC-314). tokens.css holds the values. This list
 * names the roles, so the token test can check each one in both themes and the design page can show each one.
 */

/**
 * Colours that carry a meaning. Each has the solid colour `--color-<role>`, a pale background `--color-<role>-soft`
 * and the text colour on the solid one, `--color-on-<role>`. Danger means the player may lose something they made,
 * never that they lost a game (ADR-050).
 */
export const STATUS_ROLES = Object.freeze([
  Object.freeze({ role: "success", use: "Something went well: saved, won a quest, connected." }),
  Object.freeze({ role: "warning", use: "Needs the player soon: away, reconnecting, a timer running out." }),
  Object.freeze({
    role: "danger",
    use: "The player may lose something they made: their data, a game in progress.",
  }),
  Object.freeze({ role: "info", use: "Neutral news with words. The same colour as primary (owner, D3)." }),
]);

/**
 * Who a thing belongs to, on seats, the turn banner, series dots and move highlights. Never a status colour, and
 * never the only signal: always with a word and the seat marker.
 */
export const PLAYER_ROLES = Object.freeze([
  Object.freeze({ role: "you", use: "The player looking at the screen. XP blue (owner, D2)." }),
  Object.freeze({ role: "opponent", use: "Anyone else in the game. Accent magenta (owner, D2)." }),
]);

/** Decoration and identity, never status. */
export const BRAND_COLOURS = Object.freeze([
  "--color-primary",
  "--color-accent",
  "--color-xp",
  "--color-gold",
  "--color-streak",
  "--color-game-rps",
  "--color-game-tictactoe",
  "--color-game-chess",
  "--color-tier-bronze",
  "--color-tier-silver",
  "--color-tier-gold",
  "--color-tier-platinum",
]);

/** Text sizes by job. Each is an alias of one of the seven `--text-*` sizes. */
export const TYPE_ROLES = Object.freeze([
  Object.freeze({ token: "--type-caption", use: "Small print, tags, counts." }),
  Object.freeze({ token: "--type-label", use: "Field labels, secondary lines, chips." }),
  Object.freeze({ token: "--type-body", use: "Reading text." }),
  Object.freeze({ token: "--type-title", use: "A page or dialog title." }),
  Object.freeze({ token: "--type-display", use: "The one big line of a hero or a result." }),
]);

/** Line heights by job. */
export const LEADING_ROLES = Object.freeze([
  Object.freeze({ token: "--leading-tight", use: "Headings and one-line labels." }),
  Object.freeze({ token: "--leading-body", use: "Reading text." }),
]);

/** Shadows by how high a thing sits above the page. */
export const ELEVATIONS = Object.freeze([
  Object.freeze({ token: "--elevation-1", use: "A card resting on the page." }),
  Object.freeze({ token: "--elevation-2", use: "A raised panel or a toast." }),
  Object.freeze({ token: "--elevation-3", use: "A dialog over the page." }),
]);

/**
 * The stacking layers, lowest first. The order is the order the app had before CC-314, now written once. The chess
 * board's own layers only stack inside the board.
 */
export const LAYERS = Object.freeze([
  Object.freeze({ token: "--layer-raised", value: 1, use: "A badge drawn over its own picture." }),
  Object.freeze({ token: "--layer-banner", value: 10, use: "A sticky banner, such as a request in a room." }),
  Object.freeze({ token: "--layer-tooltip", value: 15, use: "A button's reason why it cannot act." }),
  Object.freeze({ token: "--layer-toast", value: 20, use: "The toast column." }),
  Object.freeze({
    token: "--layer-banner-alert",
    value: 20,
    use: "The lost connection strip, over other banners.",
  }),
  Object.freeze({
    token: "--layer-menu",
    value: 20,
    use: "A panel that opens from the header, such as the inbox.",
  }),
  Object.freeze({ token: "--layer-dialog", value: 30, use: "A dialog and its backdrop." }),
  Object.freeze({ token: "--layer-effect", value: 40, use: "Celebrations that never take a press." }),
  Object.freeze({ token: "--layer-skip", value: 50, use: "The skip link, over everything once focused." }),
  Object.freeze({ token: "--layer-board-piece", value: 1, use: "A chess piece on its square." }),
  Object.freeze({ token: "--layer-board-slide", value: 3, use: "A chess piece sliding to its new square." }),
  Object.freeze({ token: "--layer-board-ghost", value: 5, use: "A dragged chess piece under the pointer." }),
  Object.freeze({ token: "--layer-board-promotion", value: 10, use: "The promotion picker over the board." }),
]);

/** The token names of a colour role: the solid colour, its pale background and the text on it. */
export const colourTokensOf = (role) =>
  Object.freeze({ solid: `--color-${role}`, soft: `--color-${role}-soft`, on: `--color-on-${role}` });
