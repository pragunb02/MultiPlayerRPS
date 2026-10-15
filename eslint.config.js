const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

module.exports = [
  {
    ignores: ["node_modules/", "coverage/", "dist/", "**/*.min.js", "client/public/js/chess-*.js"],
  },
  js.configs.recommended,
  prettier,
  {
    files: ["*.js", "models/**/*.js", "client/routes/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    files: ["apps/server/**/*.js", "packages/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.node },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: "error",
      "no-console": "off",
    },
  },
  {
    // Legacy browser scripts: loaded as plain <script> tags sharing globals, so cross-file
    // references and inline onclick handlers look "unused"/"undefined" to ESLint.
    // Kept as warnings until these files are replaced by the React app (CC-029).
    files: ["client/*.js", "client/public/js/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        io: "readonly",
        Chess: "readonly",
        Chessboard: "readonly",
        socket: "writable",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-redeclare": "warn",
    },
  },
];
