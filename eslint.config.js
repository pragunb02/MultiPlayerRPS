const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

const SERVER = "apps/server/src";
const TESTS = ["**/*.test.js"];

// Layer rules from docs/ENGINEERING.md §1: adjacent layers only, top-down only.
// Each entry lists what a layer may NOT import. The composition root (server.js, index.js) is exempt.
const layer = (name) => `**/${name}/**`;
const NO_DB_OR_TRANSPORT = ["mongoose", "express", "socket.io"];
const SERVER_LAYERS = {
  service: { layers: ["data", "persistence", "dependency", "config"], packages: ["mongoose"] },
  domain: { layers: ["service", "persistence", "dependency", "config"], packages: NO_DB_OR_TRANSPORT },
  data: { layers: ["service", "domain", "config"], packages: NO_DB_OR_TRANSPORT },
  persistence: {
    layers: ["service", "domain", "data", "dependency", "models", "config"],
    packages: ["express", "socket.io"],
  },
  dependency: {
    layers: ["service", "domain", "data", "persistence", "models", "config"],
    packages: NO_DB_OR_TRANSPORT,
  },
  models: {
    layers: ["service", "domain", "data", "persistence", "dependency", "config"],
    packages: NO_DB_OR_TRANSPORT,
  },
  utils: {
    layers: ["service", "domain", "data", "persistence", "dependency", "models", "config"],
    packages: NO_DB_OR_TRANSPORT,
  },
};

const layerRules = Object.entries(SERVER_LAYERS).map(([name, { layers, packages }]) => ({
  files: [`${SERVER}/${name}/**/*.js`],
  ignores: TESTS,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: packages.map((pkg) => ({ name: pkg, message: `The ${name} layer must not use ${pkg}.` })),
        patterns: [
          {
            group: layers.map(layer),
            message: `The ${name} layer may not import from: ${layers.join(", ")} (see docs/ENGINEERING.md §1).`,
          },
        ],
      },
    ],
  },
}));

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
    files: ["apps/server/**/*.js", "packages/**/*.js", "*.mjs"],
    languageOptions: { sourceType: "module", globals: globals.node },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "error",
    },
  },
  ...layerRules,
  {
    // Game engines are pure: no I/O, no hidden time or randomness (inject a clock/RNG instead).
    files: ["packages/games/**/*.js"],
    ignores: TESTS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*", "**/apps/**", ...NO_DB_OR_TRANSPORT], message: "Game engines must be pure." },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Inject an RNG into the engine instead." },
        { object: "Date", property: "now", message: "Pass time in as input instead." },
      ],
      "no-restricted-globals": ["error", "setTimeout", "setInterval", "fetch", "process"],
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
