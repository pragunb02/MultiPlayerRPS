/**
 * Lets everything already waiting run (socket events, timers, other requests) before the caller goes on. Long work
 * on the server, such as the owner console's statuses, does it between slices so live games are never held up
 * by one long stretch (CC-255).
 *
 * @returns {Promise<void>}
 */
export const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));
