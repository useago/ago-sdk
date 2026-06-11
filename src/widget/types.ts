/**
 * Widget configuration types.
 *
 * These types describe the `window.AGO` configuration object
 * used by the embeddable chat widget snippet.
 *
 * @example
 * ```ts
 * import type { AgoWidgetConfig } from "@useago/sdk/widget";
 * ```
 */

export interface AgoWidgetColors {
  button?: string;
  header?: string;
  agentMessage?: string;
  agentMessageFont?: string;
  background?: string;
  font?: string;
  userMessage?: string;
  userMessageFont?: string;
}

export interface AgoWidgetConfig {
  basepath: string;
  widgetApiKey: string;
  defaultAgent?: string;
  email?: string;
  title?: string;
  icon?: string;
  prompt?: string;
  notifications?: boolean;
  notificationMessage?: string;
  colors?: AgoWidgetColors;
  hideFooter?: boolean;
  jwt?: string;
  authToken?: string;
  permission?: string;
  metadata?: Record<string, unknown>;
}

declare global {
  interface Window {
    AGO: AgoWidgetConfig;
  }
}
