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
      external: ["react", "react-dom", "react/jsx-runtime", "vue"],
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
