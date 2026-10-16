// Where the comment style rule is switched on. The existing comments are being reworded folder by folder in the
// order of docs/ROADMAP.md section 7. Once a folder is clean it moves to `COMMENT_STYLE_ON`, so it cannot slip back.
// eslint.config.js reads this list for JavaScript and scripts/check-comments.mjs reads it for CSS.

/** Folders and files whose comments already follow the rule. The rule is an error there. */
export const COMMENT_STYLE_ON = Object.freeze([
  "packages/games",
  "packages/shared",
  "eslint-rules",
  "scripts",
]);

/**
 * The folders still to be reworded, one entry per pull request, in the order they will be done (CC-126).
 * The rule is off in all of them until their pull request moves them to `COMMENT_STYLE_ON`.
 */
export const COMMENT_STYLE_SWEEP = Object.freeze([
  Object.freeze({
    pr: 2,
    paths: Object.freeze(["apps/server/src/domain", "apps/server/src/models", "apps/server/src/config"]),
  }),
  Object.freeze({
    pr: 3,
    paths: Object.freeze([
      "apps/server/src/data",
      "apps/server/src/persistence",
      "apps/server/src/utils",
      "apps/server/src/server.js",
      "apps/server/src/service/http/app.js",
    ]),
  }),
  Object.freeze({
    pr: 4,
    paths: Object.freeze([
      "apps/server/src/service",
      "apps/server/src/testing",
      "apps/server/src/index.js",
      "apps/server/src/server.test.js",
      "apps/server/src/server.integration.test.js",
      "apps/server/src/architecture.test.js",
    ]),
  }),
  Object.freeze({
    pr: 5,
    paths: Object.freeze([
      "apps/web/src/app",
      "apps/web/src/hooks",
      "apps/web/src/lib",
      "apps/web/src/pages",
      "apps/web/src/main.jsx",
    ]),
  }),
  Object.freeze({
    // The last pull request also switches the rule on for every remaining file, such as the root config files.
    pr: 6,
    paths: Object.freeze([
      "apps/web/src/components",
      "apps/web/src/art",
      "apps/web/src/games",
      "apps/web/src/testing",
      "apps/web/src/styles",
      "e2e",
    ]),
  }),
]);

/**
 * Turns folders and files from the lists above into globs for the given file extensions.
 * A path with a file extension is a single file. It is kept only when it has one of the extensions.
 * @param {ReadonlyArray<string>} paths Folders and files, relative to the repository root.
 * @param {ReadonlyArray<string>} extensions The file extensions to match, without the dot, for example `["js", "mjs"]`.
 * @returns {ReadonlyArray<string>} One glob per kept path.
 */
export const globsFor = (paths, extensions) => {
  const files = extensions.length === 1 ? `*.${extensions[0]}` : `*.{${extensions.join(",")}}`;
  return Object.freeze(
    paths.flatMap((path) => {
      const extension = /\.(\w+)$/.exec(path);
      if (extension === null) return [`${path}/**/${files}`];
      return extensions.includes(extension[1]) ? [path] : [];
    }),
  );
};
