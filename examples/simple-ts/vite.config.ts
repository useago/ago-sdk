import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Resolve the SDK from the repo source so the example exercises local
  // changes without a build. Remove the alias to use the published package.
  resolve: {
    alias: [
      { find: '@useago/sdk/widget', replacement: fromHere('../../src/widget/index.ts') },
      { find: '@useago/sdk', replacement: fromHere('../../src/index.ts') },
    ],
  },
  server: {
    fs: { allow: [fromHere('../..')] },
  },
  build: {
    rollupOptions: {
      input: {
        main: fromHere('index.html'),
        bubble: fromHere('bubble.html'),
      },
    },
  },
});
