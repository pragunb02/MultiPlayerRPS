// How CI splits the browser suite over machines (CC-236). Playwright's own `--shard` cuts the tests into runs of
// equal count, and ours are far from equal in time: the press tests take 20 to 40 s each, most others 1 to 5 s.
// So each part is a list of whole files, balanced by the time they took on CI. Every merged run prints the time
// of each file (reportSummary.mjs); when the parts drift apart, move files between them using those numbers.
// scripts/workflows.test.mjs checks that every spec file is in exactly one part and that both CI matrices list
// exactly these parts, so a new file fails CI until it is given a part.

/** The tests that restart the server. They run on their own, one at a time, after nothing else (CC-101). */
export const RESTARTS = "restart.spec.js";

/**
 * The parts, with each file's test time on CI, desktop and mobile together (run 39085728868, 2026-10-18). About
 * 600 s each, so about 5 minutes on a machine with two workers.
 */
export const SHARDS = Object.freeze([
  // 590 s
  Object.freeze([
    "match-shell-presses-chess.spec.js", // 559
    "attacker.spec.js", // 7
    "gamification.spec.js", // 7
    "fairPlay.spec.js", // 6
    "deploy.spec.js", // 4
    "legacy.spec.js", // 3
    "names.spec.js", // 3
    "crawler.spec.js", // 1
  ]),
  // 608 s
  Object.freeze([
    "match-shell-presses-tictactoe.spec.js", // 474
    "accessibility.spec.js", // 134
  ]),
  // 605 s
  Object.freeze([
    "match-shell-presses-rps.spec.js", // 420
    "chess.spec.js", // 185
  ]),
  // 640 s
  Object.freeze([
    "match-shell.spec.js", // 160
    "save-progress.spec.js", // 62
    "computer.spec.js", // 53
    "requests.spec.js", // 39
    "visual.spec.js", // 39
    "navigation.spec.js", // 38
    "invite.spec.js", // 35
    "rematch.spec.js", // 32
    "screens.spec.js", // 31
    "waking-up.spec.js", // 30
    "sessions.spec.js", // 25
    "user.spec.js", // 23
    "guest.spec.js", // 18
    "host-away.spec.js", // new, about 15
    "owner.spec.js", // 15
    "visitor.spec.js", // 13
    "leaderboard.spec.js", // 11
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
