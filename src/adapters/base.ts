export interface LaunchOptions {
  model: string;
  baseUrl: string;
  apiKey: string;
  yolo: boolean;
  extraArgs: string[];
  dryRun?: boolean;
  sandbox?: boolean;
}

export interface AgentAdapter {
  name: string;
  aliases: string[];
  detect(): Promise<boolean>;
  supportsSandbox?: boolean;
  sandboxRefusal?: string;
  launch(opts: LaunchOptions): Promise<void>;
}

export const REGISTRY: AgentAdapter[] = [];

export function assertSandboxSupported(adapter: AgentAdapter): void {
  if (adapter.supportsSandbox) return;
  throw new Error(
    adapter.sandboxRefusal ??
      `${adapter.name}: --sandbox is not supported for this agent.`,
  );
}
