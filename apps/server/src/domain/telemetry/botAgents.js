/**
 * Known bots, crawlers, link previews and scripts, by a word in their User-Agent (CC-175, owner 2026-10-20). Their
 * batches are dropped so the counts are of people. The User-Agent is read here in memory only: it is never stored,
 * logged or sent anywhere. A real browser that names one of these words is dropped too, which is accepted.
 */
const BOT_WORDS =
  /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp\/|telegrambot|preview|curl\/|wget\/|python-requests|go-http-client|okhttp|axios\/|node-fetch|undici/i;

/**
 * Whether a User-Agent is a known bot. No User-Agent at all is a script, so it is one too.
 *
 * @param {string | undefined} userAgent
 * @returns {boolean}
 */
export const isBotAgent = (userAgent) =>
  typeof userAgent !== "string" || userAgent.trim() === "" || BOT_WORDS.test(userAgent);
