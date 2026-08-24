import js from "@eslint/js";
import tseslint from "typescript-eslint";
import noComments from "eslint-plugin-no-comments";

// Guardrails against agent-written sprawl. An LLM will happily produce a
// 200-line function with six levels of nesting that typechecks fine; these
// rules fail the build instead of leaving it for a human to notice in review.
const AGENT_SPRAWL_LIMITS = {
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-params": ["error", 3],
  "max-nested-callbacks": ["error", 3],
  "max-statements": ["error", 20],
  "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": [
    "error",
    { max: 50, skipBlankLines: true, skipComments: true },
  ],
  // One class per file — AI will dump everything into one module otherwise.
  "max-classes-per-file": ["error", 1],
  // TODO/FIXME are where half-finished AI logic hides. Finish it or cut it.
  "no-warning-comments": [
    "error",
    { terms: ["TODO", "FIXME", "HACK", "XXX"], location: "anywhere" },
  ],
  // `as Type` on unknown API data is type guarding — the right pattern here.
  // Banning it forces worse workarounds. strictTypeChecked already catches
  // the dangerous casts. Slap an `as` on a typed value to bypass a real error
  // and the type-aware rules will still flag it.
  // no-magic-numbers deliberately omitted: flags 0o777, port numbers, UID/GID.
  // Those are domain-idiomatic, not slop. Named constants would add noise.
  // id-length deliberately omitted: flags `.map(m => ...)`, `catch (e)`, loop
  // index `i`. These are universal shorthand, not unclear names.
  // ponytail: these two rules if the codebase grows beyond CLI tool scale.
};

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "docs/", "backlog/", "bin/", "**/*.cjs", "**/*.mjs", "eslint.config.js"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    plugins: { "no-comments": noComments },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...AGENT_SPRAWL_LIMITS,
      "no-comments/disallowComments": ["error", { allow: ["eslint", "global"] }],
      eqeqeq: ["error", "always"],
      // commander types every option as present, so `opts.yolo ?? false` reads as
      // a redundant check when it is the only thing standing between us and
      // undefined at runtime. The rule is wrong at this boundary, not the code.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-else-return": ["error", { allowElseIf: false }],
      "prefer-const": "error",
      // This is a CLI: stdout/stderr are the product, not stray debug output.
      "no-console": "off",
    },
  },
  {
    // A test file is a list of cases, so length limits measure the wrong thing.
    files: ["**/__test__/**", "**/*.test.ts"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      // node:test's `test()` returns a promise nobody is meant to await, and an
      // assertion callback legitimately returns whatever it returns.
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      // A stub adapter and a hand-rolled promise are test scaffolding.
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "no-comments/disallowComments": "off",
    },
  },
  {
    // Config and the bin shim are plain JS outside tsconfig, so the type-aware
    // rules have no program to consult. Syntax-level rules still apply.
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false, project: null },
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    // Existing debt, not a licence to grow: sandbox.ts is one module doing mount
    // policy, image builds, and argv assembly. Split it and drop this override.
    files: ["src/runner/sandbox.ts"],
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      // runSandbox takes 5; the extras want to be one options object.
      "max-params": ["error", 5],
    },
  },
  {
    // Existing debt: main() is the whole interactive flow -- pick agent, pick
    // model, resolve mode, launch -- in one function. Each step is a candidate
    // for extraction. Delete this override as they come out.
    files: ["src/index.ts"],
    rules: {
      complexity: ["error", 19],
      "max-statements": ["error", 30],
      "max-lines-per-function": ["error", { max: 90, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Existing debt: every adapter's launch() assembles env, argv, and the
    // sandbox decision in one method. Extract those three and drop this.
    files: ["src/adapters/claude.ts", "src/adapters/pi.ts", "src/adapters/hermes.ts"],
    rules: {
      "max-statements": ["error", 33],
      "max-lines-per-function": ["error", { max: 55, skipBlankLines: true, skipComments: true }],
    },
  },
);
