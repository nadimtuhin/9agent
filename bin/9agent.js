#!/usr/bin/env node
import("../dist/index.js").catch((e) => {
  console.error("9agent failed:", e);
  process.exit(1);
});
