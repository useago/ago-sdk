export interface BindingHandle {
  /** Whether this binding still owns the client view. */
  isCurrent(): boolean;
  /** Select a conversation while retaining ownership. */
  select(id: string | null): void;
  /** Enable server background observation without changing the selection. */
  setBackgroundObservation(enabled: boolean): void;
  /** Give up ownership without changing the selected conversation. */
  release(): void;
  /** Clear the selection and release ownership if still current. */
  detach(): void;
  /** Capture the current session and reject effects after it is reset. */
  captureOperation(): <T>(effect: () => T) => Promise<T>;
}
