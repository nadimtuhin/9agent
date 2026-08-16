export interface LaunchOptions {
  model: string;
  baseUrl: string; // full base, e.g. http://localhost:20128/v1
  apiKey: string;
  yolo: boolean;
  extraArgs: string[];
  dryRun?: boolean; // print resolved env+args, don't spawn
  sandbox?: boolean; // run the agent inside a container instead of on the host
}

export interface AgentAdapter {
  name: string;
  aliases: string[];
  detect(): Promise<boolean>;
  /** Whether this agent can run in a container. */
  supportsSandbox?: boolean;
  /** Why not, if it cannot. Shown before the prompts rather than after them. */
  sandboxRefusal?: string;
  launch(opts: LaunchOptions): Promise<void>;
}

// Ponytail: registry filled in index.ts — avoids circular import
export const REGISTRY: AgentAdapter[] = [];

/**
 * Fail before the interview, not after it: by the time launch() refuses, the
 * user has answered three prompts for a run that cannot happen.
 *
 * Every shipped adapter sets `supportsSandbox: true`, so this branch is only
 * reachable by a NEW adapter that omits the field — the moment it matters most
 * and is watched least.
 */
export function assertSandboxSupported(adapter: AgentAdapter): void {
  if (adapter.supportsSandbox) return;
  throw new Error(
    adapter.sandboxRefusal ??
      `${adapter.name}: --sandbox is not supported for this agent.`,
  );
}
