import { aiderAdapter } from "./aider.js";
import { claudeAdapter } from "./claude.js";
import { clineAdapter } from "./cline.js";
import { codexAdapter } from "./codex.js";
import { commandCodeAdapter } from "./commandcode.js";
import { hermesAdapter } from "./hermes.js";
import { jcodeAdapter } from "./jcode.js";
import { kilocodeAdapter } from "./kilocode.js";
import { opencodeAdapter } from "./opencode.js";
import { piAdapter } from "./pi.js";
import type { AgentAdapter } from "./base.js";

export const ALL_ADAPTERS: AgentAdapter[] = [
  aiderAdapter,
  claudeAdapter,
  clineAdapter,
  codexAdapter,
  commandCodeAdapter,
  hermesAdapter,
  jcodeAdapter,
  kilocodeAdapter,
  opencodeAdapter,
  piAdapter,
];
