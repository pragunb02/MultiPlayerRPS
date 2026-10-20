import { calendarVersion, parseCommit, UNKNOWN_BUILD } from "@classicade/shared";

/**
 * What the build writes into `apps/server/build-info.json` for the server to read at boot (CC-303): the commit Render
 * builds and its calendar version. Git is asked only for a value that is a commit sha, so nothing else from the
 * environment reaches a command line. Without RENDER_GIT_COMMIT, or when git cannot answer, the parts it cannot know
 * are UNKNOWN_BUILD and the build goes on.
 *
 * @param {{ env: Record<string, string | undefined>, commitDateOf: (commit: string) => string }} source
 *   `commitDateOf` answers the commit's date as git prints it, and may throw
 * @returns {{ commit: string, version: string }}
 */
export function buildInfoFor({ env, commitDateOf }) {
  const commit = parseCommit(env.RENDER_GIT_COMMIT);
  if (commit === UNKNOWN_BUILD) return { commit, version: UNKNOWN_BUILD };
  try {
    return { commit, version: calendarVersion({ commit, committedAt: commitDateOf(commit).trim() }) };
  } catch {
    return { commit, version: UNKNOWN_BUILD };
  }
}
