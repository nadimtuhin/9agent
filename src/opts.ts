// Pure arg validation lives outside index.ts so it is importable
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

/** The picker only offers ids the gateway serves, but `--model` bypassed that
 *  check entirely: a typo launched the agent against a model that does not
 *  exist and failed on its first request instead of at launch. The model list
 *  is already fetched before this runs, so validating costs no extra request. */
export function assertModelExists(model: string, ids: readonly string[]): void {
  if (ids.includes(model)) return;
  // Substring match for the hint, same rule the picker filters by.
  // Levenshtein if plain substring proves too blunt in practice.
  const near = ids.filter((id) => id.includes(model) || model.includes(id)).slice(0, 5);
  const hint = near.length
    ? `\nDid you mean: ${near.join(", ")}`
    : `\nRun 9agent without --model to pick from the ${ids.length} available.`;
  throw new Error(`Model '${model}' is not served by this gateway.${hint}`);
}
