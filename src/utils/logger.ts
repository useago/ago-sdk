/**
 * Debug logger for SDK
 */
export class Logger {
  constructor(private enabled: boolean = false) {}

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  log(...args: unknown[]): void {
    if (this.enabled) {
      console.log("[AGO SDK]", ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.enabled) {
      console.warn("[AGO SDK]", ...args);
    }
  }

  error(...args: unknown[]): void {
    // Always log errors
    console.error("[AGO SDK]", ...args);
  }

  debug(...args: unknown[]): void {
    if (this.enabled) {
      console.debug("[AGO SDK]", ...args);
    }
  }
}

export const logger = new Logger();
