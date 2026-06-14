import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        react: resolve(__dirname, "src/react/index.ts"),
        vue: resolve(__dirname, "src/vue/index.ts"),
        angular: resolve(__dirname, "src/angular/index.ts"),
        helpers: resolve(__dirname, "src/helpers/index.ts"),
        widget: resolve(__dirname, "src/widget/index.ts"),
        devtools: resolve(__dirname, "src/devtools/index.ts"),
        testing: resolve(__dirname, "src/testing/index.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "js" : "cjs";
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      // react-markdown/remark-gfm stay external (they are runtime deps, not
      // bundled). Bundling them pulls their CJS interop and a top-level
      // document.createElement into the react chunk, and rolldown then hosts a
      // shared helper there that the core chunks import, dragging react into the
      // framework-agnostic `index` entry (breaks node import). Keep them external.
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "vue",
        "react-markdown",
        "remark-gfm",
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
    sourcemap: false,
    minify: "esbuild",
  },
});
