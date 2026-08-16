// ponytail: pure arg validation lives outside index.ts so it is importable
// without triggering commander's parse side effect.
export function parseYes(mode: string): boolean {
  if (mode === "dangerous") return true;
  if (mode === "safe") return false;
  throw new Error(`--yes must be 'safe' or 'dangerous', got '${mode}'`);
}
