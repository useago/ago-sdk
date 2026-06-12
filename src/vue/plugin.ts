import type { App } from "vue";
import { AgoClient } from "../client/AgoClient";
import type { AgoConfig } from "../client/types";
import { AGO_CLIENT_KEY } from "./symbols";

export type AgoPluginOptions = AgoConfig;

/**
 * Vue plugin that provides an AgoClient to the entire app via inject/provide.
 *
 * ```ts
 * import { AgoPlugin } from "@useago/sdk/vue";
 *
 * app.use(AgoPlugin, { baseUrl: "https://YOUR-DOMAIN.useago.com" });
 * ```
 */
export const AgoPlugin = {
  install(app: App, options: AgoPluginOptions) {
    const client = new AgoClient(options);
    app.provide(AGO_CLIENT_KEY, client);
  },
};
