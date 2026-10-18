// How CI splits the browser suite over machines (CC-236). Playwright's own `--shard` cuts the tests into runs of
// equal count, and ours are far from equal in time: the press tests take 20 to 40 s each, most others 1 to 5 s.
// So each part is a list of whole files, balanced by the time they took on CI. Every merged run prints the time
// of each file (reportSummary.mjs); when the parts drift apart, move files between them using those numbers.
// scripts/workflows.test.mjs checks that every spec file is in exactly one part and that both CI matrices list
// exactly these parts, so a new file fails CI until it is given a part.

/** The tests that restart the server. They run on their own, one at a time, after nothing else (CC-101). */
export const RESTARTS = "restart.spec.js";

/**
 * The parts, with each file's test time on CI in seconds, desktop and mobile together, from the merged report of
 * CI run 39091677381 (2026-10-18). About 700 s each.
 */
export const SHARDS = Object.freeze([
  // 699 s
  Object.freeze([
    "match-shell-presses-chess.spec.js", // 592
    "owner.spec.js", // 18
    "visitor.spec.js", // 17
    "leaderboard.spec.js", // 14
    "host-away.spec.js", // 13
    "gamification.spec.js", // 12
    "attacker.spec.js", // 10
    "deploy.spec.js", // 7
    "fairPlay.spec.js", // 6
    "legacy.spec.js", // 5
    "names.spec.js", // 3
    "crawler.spec.js", // 2
  ]),
  // 691 s
  Object.freeze([
    "match-shell-presses-tictactoe.spec.js", // 509
    "accessibility.spec.js", // 182, desktop only
  ]),
  // 710 s
  Object.freeze([
    "match-shell-presses-rps.spec.js", // 512
    "chess.spec.js", // 198
  ]),
  // 690 s
  Object.freeze([
    "match-shell.spec.js", // 209
    "save-progress.spec.js", // 51
    "navigation.spec.js", // 48
    "computer.spec.js", // 47
    "invite.spec.js", // 46
    "visual.spec.js", // 46
    "requests.spec.js", // 45
    "screens.spec.js", // 40
    "rematch.spec.js", // 39
    "sessions.spec.js", // 34
    "waking-up.spec.js", // 33
    "user.spec.js", // 31
    "guest.spec.js", // 21
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
