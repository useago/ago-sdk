import type { AgoConfig } from "../client/types";
import { AgoService } from "./ago.service";

export type AgoProvideOptions = AgoConfig;

/**
 * Factory function that returns an Angular-compatible provider.
 * Use in your app's `providers` array or `bootstrapApplication`:
 *
 * ```ts
 * import { provideAgo, AgoService } from "@useago/sdk/angular";
 *
 * bootstrapApplication(AppComponent, {
 *   providers: [provideAgo({ baseUrl: "https://YOUR-DOMAIN.useago.com" })],
 * });
 *
 * // Then inject in any component:
 * const ago = inject(AgoService);
 * ```
 *
 * Returns a provider tuple compatible with Angular's DI.
 * Since this package avoids a hard Angular dependency, the provider
 * is returned as a plain object — Angular's injector accepts this format.
 */
export function provideAgo(options: AgoProvideOptions) {
  const service = new AgoService(options);
  return {
    provide: AgoService,
    useValue: service,
  };
}
