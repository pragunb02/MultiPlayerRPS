module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  plugins: ["import"],
  extends: [
    "eslint:recommended", // Extend ESLint's recommended settings
    "plugin:import/errors", // Import plugin rules
    "plugin:import/warnings",
  ],
  rules: {
    "import/named": "error",
    "import/default": "error",
    "import/namespace": "error",
    "import/export": "error",
    "import/no-unresolved": "error",
    "import/no-duplicates": "error",
    "import/newline-after-import": "off", // Keep as needed
  },
};
