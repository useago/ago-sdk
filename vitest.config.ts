import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // The glacier example has its own node_modules, so a test that imports one
    // of its modules would otherwise pull in a second copy of React and blow up
    // on the first hook. Force one copy for the whole run.
    dedupe: ["react", "react-dom"],
    // Those same modules import `@useago/sdk` by package name, which only
    // resolves once the example has been installed (it links back to the repo
    // root). CI installs the root only, so point the bare specifiers at the
    // sources under test instead. Longest prefix first: `find` is a prefix
    // match, so a bare `@useago/sdk` entry would swallow the subpaths.
    alias: [
      { find: "@useago/sdk/react", replacement: fromRoot("./src/react/index.ts") },
      { find: "@useago/sdk/vue", replacement: fromRoot("./src/vue/index.ts") },
      { find: "@useago/sdk/angular", replacement: fromRoot("./src/angular/index.ts") },
      { find: "@useago/sdk/helpers", replacement: fromRoot("./src/helpers/index.ts") },
      { find: "@useago/sdk/widget", replacement: fromRoot("./src/widget/index.ts") },
      { find: "@useago/sdk/devtools", replacement: fromRoot("./src/devtools/index.ts") },
      { find: "@useago/sdk/testing", replacement: fromRoot("./src/testing/index.ts") },
      { find: "@useago/sdk", replacement: fromRoot("./src/index.ts") },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
