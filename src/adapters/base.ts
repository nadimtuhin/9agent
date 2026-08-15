export interface LaunchOptions {
  model: string;
  baseUrl: string; // full base, e.g. http://localhost:20128/v1
  apiKey: string;
  yolo: boolean;
  extraArgs: string[];
  dryRun?: boolean; // print resolved env+args, don't spawn
}

export interface AgentAdapter {
  name: string;
  aliases: string[];
  detect(): Promise<boolean>;
  launch(opts: LaunchOptions): Promise<void>;
}

// Ponytail: registry filled in index.ts — avoids circular import
export const REGISTRY: AgentAdapter[] = [];
