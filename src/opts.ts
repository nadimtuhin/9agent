// ponytail: pure arg validation lives outside index.ts so it is importable
// without triggering commander's parse side effect.
export function parseYes(mode: string): boolean {
  if (mode === "dangerous") return true;
  if (mode === "safe") return false;
  throw new Error(`--yes must be 'safe' or 'dangerous', got '${mode}'`);
}

/** `sk_9router` is a local placeholder, not a credential -- 9Router accepts it
 *  from loopback. A sandboxed agent arrives as a remote client and needs a real key. */
export function resolveKey(flag?: string): string {
  return flag ?? process.env.NINEROUTER_KEY ?? process.env.LOCAL_9ROUTER_KEY ?? "sk_9router";
}
