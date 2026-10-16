const js = require("@eslint/js");
const reactHooks = require("eslint-plugin-react-hooks");
const reactRefreshModule = require("eslint-plugin-react-refresh");
// Published as an ES module: require() returns it under `default`.
const reactRefresh = reactRefreshModule.default ?? reactRefreshModule;
const globals = require("globals");
const prettier = require("eslint-config-prettier");

const SERVER = "apps/server/src";
const TESTS = ["**/*.test.js", "**/*.test.jsx"];

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
    ignores: ["node_modules/", "coverage/", "**/dist/"],
  },
  js.configs.recommended,
  prettier,
  {
    files: ["*.js"], // this config file
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    files: [
      "apps/server/**/*.js",
      "packages/**/*.js",
      "*.mjs",
      "apps/web/vite.config.js",
      "e2e/**/*.{js,mjs}",
    ],
    languageOptions: { sourceType: "module", globals: globals.node },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "error",
    },
  },
  {
    // Browser tests: callbacks passed to page.evaluate() run in the page.
    files: ["e2e/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  ...layerRules,
  {
    // Web app (React + Vite): browser globals, JSX, hooks rules. Components never call fetch/sockets directly —
    // only lib/ does (docs/ENGINEERING.md §1, "Frontend").
    files: ["apps/web/src/**/*.{js,jsx}"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      // The CSP is `style-src 'self'` (CC-030): a style attribute would be blocked in production (ADR-012).
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style']",
          message: "inline styles violate CSP; use a CSS module",
        },
      ],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      eqeqeq: "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "error",
    },
  },
  {
    files: ["apps/web/src/{pages,components}/**/*.{js,jsx}"],
    ignores: TESTS,
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use the API client in src/lib via a hook." },
      ],
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "socket.io-client", message: "Use the socket client in src/lib via a hook." }] },
      ],
    },
  },
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
];
