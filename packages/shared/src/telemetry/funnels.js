/**
 * The registered funnels (CC-313): each a fixed list of steps, each step with the ticket that added it. The browser
 * sends `funnel_step_reached` once per page load per step, and drop-off between two steps is one minus the ratio of
 * their daily totals, labelled as a ratio of totals (ADR-034). A ticket that adds a step to a flow registers it here.
 */

/**
 * @typedef {{ id: string, ticket: string }} FunnelStep
 * @typedef {{ id: string, ticket: string, steps: ReadonlyArray<Readonly<FunnelStep>> }} Funnel
 */

const step = (id, ticket) => Object.freeze({ id, ticket });
const funnel = (id, ticket, steps) => Object.freeze({ id, ticket, steps: Object.freeze(steps) });

/** @type {ReadonlyArray<Readonly<Funnel>>} */
export const FUNNELS = Object.freeze([
  funnel("visit_to_play", "CC-313", [
    step("landed", "CC-174"),
    step("game_opened", "CC-023"),
    step("seated", "CC-015"),
    step("first_move", "CC-220"),
  ]),
  funnel("link_to_seat", "CC-313", [step("link_opened", "CC-279"), step("seated", "CC-015")]),
  funnel("sign_up", "CC-313", [
    step("form_viewed", "CC-025"),
    step("form_submitted", "CC-025"),
    step("account_created", "CC-076"),
  ]),
  funnel("challenge", "CC-313", [step("challenge_opened", "CC-139"), step("challenge_accepted", "CC-139")]),
]);

/** Every funnel id, and every step id of any funnel. */
export const FUNNEL_IDS = Object.freeze(FUNNELS.map(({ id }) => id));
export const FUNNEL_STEP_IDS = Object.freeze([
  ...new Set(FUNNELS.flatMap(({ steps }) => steps.map(({ id }) => id))),
]);

/**
 * Whether a step belongs to a funnel.
 *
 * @param {unknown} funnelId
 * @param {unknown} stepId
 * @returns {boolean}
 */
export const isFunnelStep = (funnelId, stepId) =>
  FUNNELS.some(({ id, steps }) => id === funnelId && steps.some((each) => each.id === stepId));
