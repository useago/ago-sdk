/* ESLint config for the AGO SDK (eslint 8 + @typescript-eslint 8, eslintrc style). */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  ignorePatterns: ["dist/", "node_modules/", "*.cjs"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    // Allow intentional infinite loops like `while (true)` over stream readers.
    "no-constant-condition": ["error", { checkLoops: false }],
  },
  overrides: [
    {
      // React Hook rules only apply to the React entry point. Vue/Angular
      // composables named `useX` are not React hooks.
      files: ["src/react/**/*.{ts,tsx}"],
      plugins: ["react-hooks"],
      extends: ["plugin:react-hooks/recommended"],
    },
  ],
};
