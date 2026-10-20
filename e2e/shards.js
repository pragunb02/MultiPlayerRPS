// How CI splits the browser suite over machines (CC-236). Playwright's own `--shard` cuts the tests into runs of
// equal count, and ours are far from equal in time: the press tests take 20 to 40 s each, most others 1 to 5 s.
// So each part is a list of whole files, balanced by the time they took on CI. Every merged run prints the time
// of each file (reportSummary.mjs); when the parts drift apart, move files between them using those numbers.
// scripts/workflows.test.mjs checks that every spec file is in exactly one part and that both CI matrices list
// exactly these parts, so a new file fails CI until it is given a part.

/**
 * The tests that restart the server (CC-101), or run it with short room times for a while (CC-207). They run on
 * their own, one at a time, so they cut off nothing else.
 */
export const RESTARTS = /restart[a-z-]*\.spec\.js$/;

/**
 * The parts, with each file's test time on CI in seconds, desktop and mobile together, three workers per machine,
 * from the merged report of CI run 39094168823 (2026-10-18). About 1100 s each.
 */
export const SHARDS = Object.freeze([
  // 1132 s
  Object.freeze([
    "match-shell-presses-chess.spec.js", // 1022
    "owner.spec.js", // 24
    "visitor.spec.js", // 19
    "attacker.spec.js", // 17
    "gamification.spec.js", // 16
    "deploy.spec.js", // 10
    "fairPlay.spec.js", // 9
    "legacy.spec.js", // 7
    "crawler.spec.js", // 4
    "share.spec.js", // new (CC-217), about 10 s locally
    "names.spec.js", // 4
    "privacy.spec.js", // new (CC-035, CC-152), about 25 s locally
    "blocks.spec.js", // new (CC-044), not measured yet
    "profiles.spec.js", // new (CC-034), not measured yet
    "feedback.spec.js", // new (CC-290), not measured yet
    "friends.spec.js", // new (CC-052), not measured yet
  ]),
  // 1078 s
  Object.freeze([
    "match-shell-presses-tictactoe.spec.js", // 875
    "accessibility.spec.js", // 203, desktop only
    "dead-space.spec.js", // new (CC-259), not measured yet
    "layout-width.spec.js", // new (CC-256, CC-270), about 15 s a phone size locally
    "pass-and-play.spec.js", // new (CC-223), about 30 s locally
    "daily-puzzle.spec.js", // new (CC-144), not measured yet
    "seat-ids.spec.js", // new (CC-253), about 10 s locally
    "match-history-ids.spec.js", // new (CC-297), about 10 s locally
  ]),
  // 1106 s
  Object.freeze([
    "match-shell-presses-rps.spec.js", // 846
    "chess.spec.js", // 260
    "flags.spec.js", // new (CC-312), not measured yet
  ]),
  // 1107 s
  Object.freeze([
    "match-shell.spec.js", // 347
    "requests.spec.js", // 122
    "save-progress.spec.js", // 71
    "computer.spec.js", // 67
    "navigation.spec.js", // 65
    "presence.spec.js", // 61
    "invite.spec.js", // 59
    "visual.spec.js", // 52
    "rematch.spec.js", // 49
    "user.spec.js", // 39
    "sessions.spec.js", // 38
    "screens.spec.js", // 35
    "waking-up.spec.js", // 32
    "guest.spec.js", // 27
    "leaderboard.spec.js", // 22
    "host-away.spec.js", // 21
  ]),
]);

/**
 * The files of part `shard` (1 to SHARDS.length), or every spec file when no part is asked for.
 *
 * @param {string | undefined} shard the E2E_SHARD environment variable
 * @returns {string | readonly string[]}
 */
export function specFilesFor(shard) {
  if (shard === undefined) return "*.spec.js";
  const index = Number(shard);
  if (!Number.isInteger(index) || index < 1 || index > SHARDS.length) {
    throw new Error(`E2E_SHARD must be a whole number from 1 to ${SHARDS.length}, not "${shard}"`);
  }
  return SHARDS[index - 1];
}
