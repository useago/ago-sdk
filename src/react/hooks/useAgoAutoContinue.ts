import { useEffect, useRef } from "react";
import {
  attachAutoContinueAfterNavigation,
  __AUTO_CONTINUE_DEFAULT_PROMPT,
} from "../../client/autoContinue";
import type { AgoAutoContinueOptions } from "../../client/autoContinue";
import { useAgoClient } from "../context/AgoContext";

export type { AgoAutoContinueOptions };

/**
 * Auto-continue the agent after it navigates, so a "go to page B and change X"
 * request completes in one user gesture. Mount this once inside `AgoProvider`.
 *
 * React binding of {@link attachAutoContinueAfterNavigation} — see it for the
 * pause-mode / placeholder-mode mechanics.
 *
 * ```tsx
 * function AppShell() {
 *   useAgoNavigation(navigate, routes);
 *   useAgoAutoContinueAfterNavigation();
 *   return <Outlet />;
 * }
 * ```
 */
export function useAgoAutoContinueAfterNavigation(
  options?: AgoAutoContinueOptions
): void {
  const client = useAgoClient();

  // Read options via a ref so toggling them never re-subscribes the listeners.
  const optsRef = useRef<AgoAutoContinueOptions | undefined>(options);
  optsRef.current = options;

  useEffect(
    () => attachAutoContinueAfterNavigation(client, () => optsRef.current),
    [client]
  );
}

/** @internal exported for tests. */
export { __AUTO_CONTINUE_DEFAULT_PROMPT };
