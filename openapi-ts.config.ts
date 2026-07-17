import { defineConfig } from "@hey-api/openapi-ts";

// Types + Zod validators only — no generated runtime client. Mirrors the
// precedent set by ComfyUI_frontend's `@comfyorg/ingest-types` package
// (verified before choosing this path; see the PR description) and the
// Python SDK's own split: generated models, hand-written transport
// (`src/low/transport.ts`) over the mandatory escape hatches (raw response,
// streaming bodies, per-request AbortSignal).
export default defineConfig({
  input: "./spec/openapi.yaml",
  output: {
    // A subfolder, not `./src/low` itself: the generator overwrites every
    // file it owns (including `index.ts`) on every run, and `src/low/index.ts`
    // is the hand-written aggregator for the whole low layer (transport,
    // errors, SSE decoding, plus these generated models) — it must never be
    // clobbered by codegen.
    path: "./src/low/generated",
    clean: true,
  },
  parser: {
    filters: {
      operations: {
        // Path-regex exclusion (the same mechanism ComfyUI_frontend's
        // ingest-types config uses — tag-based exclusion is unreliable in
        // this openapi-ts version, see hey-api/openapi-ts#3661). Operations
        // tagged `internal` / `x-internal: true` are already stripped
        // before this spec is vendored, so nothing matches today; this
        // guards against a future vendoring slip re-introducing one.
        exclude: ["/\\/api\\/internal\\//", "/\\/api\\/webhooks\\//"],
      },
    },
  },
  plugins: [
    "@hey-api/typescript",
    {
      name: "zod",
      definitions: true,
      requests: true,
      responses: true,
    },
  ],
});
