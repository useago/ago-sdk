import { AgoError } from "./errors";

/** Internal coordination between one client and its framework bindings. */
const owners = new WeakMap<object, symbol>();
const operations = new WeakMap<object, symbol>();

export function withBindingOwnership<T>(
  client: object,
  token: symbol,
  operation: () => T,
): T {
  if (owners.get(client) !== token) return operation();
  operations.set(client, token);
  try {
    return operation();
  } finally {
    operations.delete(client);
  }
}

export function beginBindingActivation<T>(
  client: object,
  activate: () => Promise<T>,
): { token: symbol; result: Promise<T> } {
  const token = Symbol();
  owners.set(client, token);
  try {
    return { token, result: withBindingOwnership(client, token, activate) };
  } catch (error) {
    if (owners.get(client) === token) owners.delete(client);
    throw error;
  }
}

export function currentBindingOperation(client: object): symbol | undefined {
  return operations.get(client);
}

export function isBindingOwner(client: object, token: symbol): boolean {
  return owners.get(client) === token;
}

export function invalidateBindingOwner(
  client: object,
  preserve?: symbol,
): void {
  if (preserve === undefined || owners.get(client) !== preserve)
    owners.delete(client);
}

type PrincipalGuard = <T>(effect: () => T) => Promise<Awaited<T>>;
const principalCaptures = new WeakMap<object, () => PrincipalGuard>();

export function registerBindingPrincipalCapture(client: object, capture: () => PrincipalGuard): void {
  principalCaptures.set(client, capture);
}

export function captureBindingPrincipal(client: object): PrincipalGuard {
  const capture = principalCaptures.get(client);
  if (!capture) throw new AgoError("Binding principal guard is unavailable for this client.", "binding_guard_unavailable");
  return capture();
}
