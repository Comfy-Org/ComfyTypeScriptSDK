/**
 * Hand-maintained supplement to the generated models.
 *
 * `@hey-api/openapi-ts` only emits types reachable from an operation's
 * request/response schema. Four schemas in `spec/openapi.yaml` are
 * documented but never referenced that way — the SSE event payloads
 * (`StatusEvent`, `PreviewEvent`, `LogEvent`; `progress` and `output`
 * events reuse the generated `Progress`/`Output` types directly) are only
 * reachable via the non-standard `x-sse-events` vendor extension, and
 * `AssetReference` (the `core/ASSET` object) documents a shape substituted
 * into workflow JSON, not a request/response body. Kept here by hand
 * instead of forcing codegen to walk vendor extensions it doesn't
 * understand. `tests/spec-coverage.test.ts` asserts these stay in sync with
 * the spec's property lists.
 */

import type { JobStatus } from "./generated/types.gen.js";

/** SSE `status` event payload. */
export interface StatusEvent {
  status: JobStatus;
  queue_position?: number | null;
}

/** SSE `preview` event payload (JPEG, base64, throttled). */
export interface PreviewEvent {
  node_id: string;
  content_type: string;
  data_base64: string;
}

/** SSE `log` event payload. Best-effort diagnostics. */
export interface LogEvent {
  level: string;
  message: string;
}

/**
 * The typed asset-reference object placed inside workflow JSON where a
 * filename would normally go: `{"__type": "core/ASSET", "info": {"id":
 * "asset_...", "hash": "blake3:...", "file_path": "photo.png"}}`. `info.id`
 * is required and authoritative; `hash`/`file_path` are optional
 * staging/lookup hints.
 */
export interface AssetReference {
  __type: "core/ASSET";
  info: {
    id: string;
    hash?: string;
    file_path?: string;
  };
}
