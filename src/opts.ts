export function parseYes(mode: string): boolean {
  if (mode === "dangerous") return true;
  if (mode === "safe") return false;
  throw new Error(`--yes must be 'safe' or 'dangerous', got '${mode}'`);
}

export function resolveKey(flag?: string): string {
  return flag || process.env.NINEROUTER_KEY || process.env.LOCAL_9ROUTER_KEY || "sk_9router";
}

export function assertModelExists(model: string, ids: readonly string[]): void {
  if (ids.includes(model)) return;
  const near = ids.filter((id) => id.includes(model) || model.includes(id)).slice(0, 5);
  const hint = near.length
    ? `\nDid you mean: ${near.join(", ")}`
    : `\nRun 9agent without --model to pick from the ${ids.length} available.`;
  throw new Error(`Model '${model}' is not served by this gateway.${hint}`);
}
