import { isCalendarVersionOf, parseCommit, UNKNOWN_BUILD } from "@classicade/shared";

/**
 * @typedef {{ commit: string, version: string }} BuildSettings   the deployed commit's full sha and its version, each
 *   UNKNOWN_BUILD when it cannot be known
 */

/** The build file as JSON, or an empty object when it is missing or broken. A missing file is normal off Render. */
function readBuildFile(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The commit and version this server runs (CC-303), the one place both are read. The commit is Render's
 * RENDER_GIT_COMMIT, shown only when it is a sha. The version is the one `scripts/bin/build-info.mjs` wrote during
 * the build, used only when the file was written for this same commit and has the calendar shape. Anything missing,
 * broken or out of shape is UNKNOWN_BUILD and never stops the boot, because this is information, not configuration.
 *
 * @param {{ env: Record<string, string | undefined>, buildInfoText: string }} source  `buildInfoText` is the build
 *   file's text, "" when there is none
 * @returns {Readonly<BuildSettings>}
 */
export function parseBuild({ env, buildInfoText }) {
  const commit = parseCommit(env.RENDER_GIT_COMMIT);
  const file = readBuildFile(buildInfoText);
  const version =
    commit !== UNKNOWN_BUILD && file.commit === commit && isCalendarVersionOf(file.version, commit)
      ? file.version
      : UNKNOWN_BUILD;
  return Object.freeze({ commit, version });
}
