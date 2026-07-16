/**
 * Thin `low` transport over `fetch` — one async function per `operationId`
 * in `spec/openapi.yaml`, plus the mandatory escape hatches the hand-written
 * `sdk` layer builds on:
 *
 * - **raw response access** — every method's Promise resolves from (or, via
 *   {@link ComfyLow.request}, directly returns) a `Response` whose body is
 *   never pre-read.
 * - **unbuffered / streaming bodies** — a `fetch` `Response.body` is always a
 *   lazy `ReadableStream`; nothing here buffers it before the caller asks
 *   for `.json()`/`.body`. This is why, unlike the Python transport (which
 *   distinguishes a buffering `raw_request` from a streaming `open`), there
 *   is exactly one request primitive here — fetch's laziness already gives
 *   both hatches from a single call.
 * - **streaming request bodies** — `postAssets` takes a `Blob` (a Node
 *   `fs.openAsBlob()` handle is a lazy, disk-backed `Blob`, so a multi-GB
 *   upload is never buffered whole in memory) inside a native `FormData`;
 *   `fetch`/undici streams the encoded body to the wire.
 * - **per-request timeout/abort** — every method accepts `signal` and
 *   `timeoutMs`; `AbortSignal.any` composes a caller's signal with this
 *   client's default timeout (or overrides/disables it per call).
 *
 * This layer contains no orchestration, retries, hashing, or SSE
 * reconnection — those live in `../sdk`. Mirrors `comfy_low.transport` in
 * the Python SDK (its `AsyncComfyLow`; there is no sync variant here — see
 * the package README for why).
 */

import { errorFromEnvelope } from "./errors.js";
import type { Asset, AssetFromHashData, Job, PostJobsData } from "./generated/types.gen.js";
import { iterateSse, type RawEvent } from "./sse.js";

const API_PREFIX = "/api/v2";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  headers?: Record<string, string>;
  json?: unknown;
  body?: string | FormData;
  signal?: AbortSignal;
  /**
   * Per-request timeout. `undefined` uses the client's default; `null`
   * disables the default timeout entirely (used for the SSE stream, which
   * must not time out while idle mid-job).
   */
  timeoutMs?: number | null;
}

export interface ComfyLowOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function looksLikePath(value: string): boolean {
  return value.startsWith("http") || value.startsWith("/");
}

function parseRetryAfter(response: Response): number | null {
  const raw = response.headers.get("Retry-After");
  if (raw === null) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isNaN(seconds) ? null : seconds;
}

/** Synchronous protocol bindings — async throughout (JS is async-native). */
export class ComfyLow {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(baseUrl: string, apiKey?: string, options: ComfyLowOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private urlFor(path: string): string {
    if (path.startsWith("http")) return path;
    if (path.startsWith("/api/")) return this.baseUrl + path;
    return this.baseUrl + API_PREFIX + path;
  }

  /**
   * Is `url` on the same origin (scheme + host + port) as this client's
   * `baseUrl`? A relative `path` always resolves to a `baseUrl`-derived URL
   * (see {@link urlFor}), so this only ever says "no" for a server-returned
   * absolute URL (`model.urls.self`/`cancel`/`events`) that points somewhere
   * else — which is exactly the case where the bearer token must not be
   * attached.
   */
  private isSameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
  }

  private buildHeaders(url: string, extra?: Record<string, string>): Headers {
    const headers = new Headers();
    // Only authenticate when a key is set (a local proxy fronts a ComfyUI
    // with no auth, so we never leak credentials it does not want) AND the
    // request target is this client's own origin. `getJob`/`cancelJob`/
    // `getJobEvents` can be fed a server-returned absolute URL
    // (`model.urls.self/cancel/events`); if that ever points at a different
    // host, the bearer token must not follow it there.
    if (this.apiKey && this.isSameOrigin(url)) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        headers.set(key, value);
      }
    }
    return headers;
  }

  private resolveSignal(
    callerSignal: AbortSignal | undefined,
    timeoutMs: number | null | undefined,
  ): AbortSignal | undefined {
    const effective = timeoutMs === undefined ? this.defaultTimeoutMs : timeoutMs;
    if (effective === null) return callerSignal;
    const timeoutSignal = AbortSignal.timeout(effective);
    return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  }

  /**
   * The single escape hatch: an unread `Response` (raw headers/status,
   * lazy body) for a request built from `{json | body}`. Every typed
   * method below is a thin wrapper over this.
   */
  async request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const url = this.urlFor(path);
    const headers = this.buildHeaders(url, options.headers);
    let body = options.body;
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.json);
    }
    const signal = this.resolveSignal(options.signal, options.timeoutMs);
    return this.fetchImpl(url, { method, headers, body, signal, redirect: "follow" });
  }

  private async parseOrRaise<T>(response: Response, ok: readonly number[]): Promise<T> {
    if (ok.includes(response.status)) {
      if (response.status === 204 || response.headers.get("Content-Length") === "0") {
        return {} as T;
      }
      const text = await response.text();
      return text ? (JSON.parse(text) as T) : ({} as T);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw errorFromEnvelope(response.status, body as never, {
      retryAfter: parseRetryAfter(response),
    });
  }

  // -- assets -------------------------------------------------------------

  /** `POST /api/v2/assets` — streaming multipart upload. */
  async postAssets(
    file: Blob,
    contentType: string,
    filePath: string,
    options: {
      expectedHash?: string;
      tags?: readonly string[];
      idempotencyKey?: string;
      signal?: AbortSignal;
      timeoutMs?: number | null;
    } = {},
  ): Promise<Asset> {
    const form = new FormData();
    form.append("file", file, filePath);
    form.append("content_type", contentType);
    form.append("file_path", filePath);
    if (options.expectedHash !== undefined) {
      form.append("expected_hash", options.expectedHash);
    }
    for (const tag of options.tags ?? []) {
      form.append("tags", tag);
    }
    const headers: Record<string, string> = {};
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    const response = await this.request("POST", "/assets", {
      headers,
      body: form,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    return this.parseOrRaise<Asset>(response, [200, 201, 202]);
  }

  /** `POST /api/v2/assets/from-hash` — dedup mint over existing bytes. */
  async assetFromHash(
    hash: string,
    options: { filePath?: string; tags?: readonly string[]; signal?: AbortSignal } = {},
  ): Promise<Asset> {
    const json: AssetFromHashData["body"] = { hash };
    if (options.filePath !== undefined) json.file_path = options.filePath;
    if (options.tags !== undefined) json.tags = [...options.tags];
    const response = await this.request("POST", "/assets/from-hash", {
      json,
      signal: options.signal,
    });
    return this.parseOrRaise<Asset>(response, [200, 201]);
  }

  /** `HEAD /api/v2/assets/by-hash/{hash}` — existence probe. */
  async headAssetByHash(hash: string, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    const response = await this.request("HEAD", `/assets/by-hash/${encodeURIComponent(hash)}`, {
      signal: options.signal,
    });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    return this.parseOrRaise<boolean>(response, [200]);
  }

  /** `GET /api/v2/assets/{id}` — metadata with a fresh content URL. */
  async getAsset(assetId: string, options: { signal?: AbortSignal } = {}): Promise<Asset> {
    const response = await this.request("GET", `/assets/${encodeURIComponent(assetId)}`, {
      signal: options.signal,
    });
    return this.parseOrRaise<Asset>(response, [200]);
  }

  /**
   * `GET /api/v2/assets/{id}/content` — raw, streamed, range-aware body.
   * Returns the response itself (escape hatch); the caller reads
   * `response.body`.
   */
  async getAssetContent(
    assetId: string,
    options: { range?: readonly [number, number]; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.range) {
      headers.Range = `bytes=${options.range[0]}-${options.range[1]}`;
    }
    const response = await this.request("GET", `/assets/${encodeURIComponent(assetId)}/content`, {
      headers,
      signal: options.signal,
    });
    if (response.status !== 200 && response.status !== 206) {
      await this.parseOrRaise(response, [200, 206]);
    }
    return response;
  }

  // -- jobs -----------------------------------------------------------------

  /** `POST /api/v2/jobs` — returns `{job, replayed}`. */
  async postJobs(
    workflow: Record<string, unknown>,
    options: { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<{ job: Job; replayed: boolean }> {
    const headers: Record<string, string> = {};
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    const json: PostJobsData["body"] = { workflow };
    const response = await this.request("POST", "/jobs", { headers, json, signal: options.signal });
    const job = await this.parseOrRaise<Job>(response, [201]);
    return { job, replayed: response.headers.get("Idempotency-Replayed") === "true" };
  }

  /** `GET /api/v2/jobs/{id}` (or an absolute self link). */
  async getJob(jobIdOrUrl: string, options: { signal?: AbortSignal } = {}): Promise<Job> {
    const path = looksLikePath(jobIdOrUrl) ? jobIdOrUrl : `/jobs/${encodeURIComponent(jobIdOrUrl)}`;
    const response = await this.request("GET", path, { signal: options.signal });
    return this.parseOrRaise<Job>(response, [200]);
  }

  /**
   * `GET /api/v2/jobs/{id}/events` — raw live SSE iterator (escape hatch).
   * No reconnection here; a single connection's frames. `../sdk` adds the
   * reconnect loop. No default timeout: an idle stream must not time out
   * mid-job (pass `timeoutMs` to override).
   */
  async *getJobEvents(
    jobIdOrUrl: string,
    options: { signal?: AbortSignal; timeoutMs?: number | null } = {},
  ): AsyncGenerator<RawEvent, void, void> {
    const path = looksLikePath(jobIdOrUrl)
      ? jobIdOrUrl
      : `/jobs/${encodeURIComponent(jobIdOrUrl)}/events`;
    const response = await this.request("GET", path, {
      headers: { Accept: "text/event-stream" },
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? null,
    });
    if (response.status !== 200) {
      await this.parseOrRaise(response, [200]);
      return;
    }
    if (!response.body) return;
    yield* iterateSse(response.body);
  }

  /** `POST /api/v2/jobs/{id}/cancel` — idempotent. */
  async cancelJob(jobIdOrUrl: string, options: { signal?: AbortSignal } = {}): Promise<Job> {
    const path = looksLikePath(jobIdOrUrl)
      ? jobIdOrUrl
      : `/jobs/${encodeURIComponent(jobIdOrUrl)}/cancel`;
    const response = await this.request("POST", path, { signal: options.signal });
    return this.parseOrRaise<Job>(response, [200]);
  }
}

// The exact set of operationIds the transport must cover; the spec-coverage
// test asserts this equals the set of operationIds in spec/openapi.yaml.
export const OPERATION_IDS = [
  "postAssets",
  "assetFromHash",
  "headAssetByHash",
  "getAsset",
  "getAssetContent",
  "postJobs",
  "getJob",
  "getJobEvents",
  "cancelJob",
] as const;

// operationId -> transport method name.
export const OPERATION_METHODS: Record<(typeof OPERATION_IDS)[number], keyof ComfyLow> = {
  postAssets: "postAssets",
  assetFromHash: "assetFromHash",
  headAssetByHash: "headAssetByHash",
  getAsset: "getAsset",
  getAssetContent: "getAssetContent",
  postJobs: "postJobs",
  getJob: "getJob",
  getJobEvents: "getJobEvents",
  cancelJob: "cancelJob",
};
