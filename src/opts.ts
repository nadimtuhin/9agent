import { getLastAgent, getLastModels } from "./profiles.js";

export function parseYes(mode: string): boolean {
  if (mode === "dangerous") return true;
  if (mode === "safe") return false;
  throw new Error(`--yes must be 'safe' or 'dangerous', got '${mode}'`);
}

export function resolveKey(saved?: string): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty strings should be treated as unset
  return saved || process.env.NINEROUTER_KEY || process.env.LOCAL_9ROUTER_KEY || "sk_9router";
}

export function assertModelExists(model: string, ids: readonly string[]): void {
  if (ids.includes(model)) return;
  const near = ids.filter((id) => id.includes(model) || model.includes(id)).slice(0, 5);
  const hint = near.length
    ? `\nDid you mean: ${near.join(", ")}`
    : `\nRun 9agent without --model to pick from the ${ids.length} available.`;
  throw new Error(`Model '${model}' is not served by this gateway.${hint}`);
}

export function resolveModelFuzzy(flag: string, ids: readonly string[]): string | null {
  const matches = ids.filter((id) => id.includes(flag) || flag.includes(id));
  return matches.length === 1 ? matches[0] : null;
}

export function applyLastOpts(
  opts: { agent?: string; model?: string; yes?: string; yolo?: boolean; last?: boolean },
  gateway: string,
): void {
  if (!opts.last) return;
  if (!opts.agent) {
    const savedAgent = getLastAgent();
    if (!savedAgent) {
      throw new Error("No previous agent saved — pick an agent once first.");
    }
    opts.agent = savedAgent;
  }
  if (!opts.model) {
    const savedModels = getLastModels(gateway);
    if (!savedModels || savedModels.length === 0) {
      throw new Error(`No previous model saved for ${gateway} — pick a model once first.`);
    }
    opts.model = savedModels.join(",");
  }
  if (opts.yes === undefined && !opts.yolo) {
    opts.yes = "safe";
  }
}
