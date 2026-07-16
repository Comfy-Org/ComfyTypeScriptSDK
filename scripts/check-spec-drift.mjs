#!/usr/bin/env node
/**
 * Fail if the committed `src/low/generated/*` drift from `spec/openapi.yaml`.
 *
 * Regenerates into a temp directory using the exact same config as
 * `pnpm generate` and diffs the result against what's committed. CI runs
 * this so a spec edit without a regen (or a hand-edit of a generated file)
 * is caught. Mirrors `scripts/check_drift.py` in the Python SDK.
 */

import { createClient } from "@hey-api/openapi-ts";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMITTED_DIR = join(ROOT, "src", "low", "generated");
const GENERATED_FILES = ["types.gen.ts", "zod.gen.ts", "index.ts"];

async function main() {
  const configModule = await import(join(ROOT, "openapi-ts.config.ts"));
  const baseConfig = configModule.default;

  const tmpDir = await mkdtemp(join(tmpdir(), "comfy-sdk-drift-"));
  try {
    await createClient({
      ...baseConfig,
      output: { ...baseConfig.output, path: tmpDir },
      logs: { level: "silent" },
    });

    let drifted = false;
    for (const file of GENERATED_FILES) {
      const [fresh, committed] = await Promise.all([
        readFile(join(tmpDir, file), "utf-8").catch(() => null),
        readFile(join(COMMITTED_DIR, file), "utf-8").catch(() => null),
      ]);
      if (fresh === null) {
        console.error(`ERROR: codegen did not produce ${file}`);
        drifted = true;
        continue;
      }
      if (fresh !== committed) {
        console.error(
          `ERROR: ${join("src/low/generated", file)} is stale relative to spec/openapi.yaml.`,
        );
        drifted = true;
      }
    }

    if (drifted) {
      console.error("\nRun `pnpm generate` and commit the result.");
      process.exitCode = 1;
      return;
    }
    console.log("OK: src/low/generated is in sync with spec/openapi.yaml");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

await main();
