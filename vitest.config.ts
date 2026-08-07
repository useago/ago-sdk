import { defineConfig } from "vitest/config";

export default defineConfig({
  // The glacier example has its own node_modules, so a test that imports one of
  // its modules would otherwise pull in a second copy of React and blow up on
  // the first hook. Force one copy for the whole run.
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
