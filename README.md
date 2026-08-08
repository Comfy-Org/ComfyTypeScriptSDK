<div align="center">
<img src="assets/logo.svg" alt="Comfy" width="130"/>
<h1>comfy-typescript-sdk</h1>
<p>
  <strong>The TypeScript client for the <a href="https://docs.comfy.org">Comfy API v2</a>.</strong><br/>
  Submit a workflow, stream its progress, get your outputs — against self-hosted ComfyUI, Comfy Cloud, or serverless.
</p>
</div>

<p align="center">
  <a href="https://www.npmjs.com/package/@comfyorg/sdk"><img src="https://img.shields.io/npm/v/@comfyorg/sdk?style=for-the-badge&logo=npm&logoColor=white&label=npm" alt="npm"></a>
  <a href="#requirements-and-install"><img src="https://img.shields.io/badge/Node-%3E%3D22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node >=22"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-lightgrey?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://cloud.comfy.org"><img src="https://img.shields.io/badge/Comfy_Cloud-cloud.comfy.org-211927?style=for-the-badge" alt="Comfy Cloud"></a>
</p>

---

TypeScript SDK for running ComfyUI workflows via the **Comfy API v2**. The same
code runs against a self-hosted ComfyUI instance, Comfy Cloud, or a serverless
deployment — only the base URL and an optional API key change.

## Requirements and install

Requires **Node >=22** (Node 20 reached end-of-life; browser support is out of
scope for v1). Dependencies: [`hash-wasm`](https://www.npmjs.com/package/hash-wasm),
[`zod`](https://zod.dev), `eventsource-parser`.

```bash
npm i @comfyorg/sdk
pnpm add @comfyorg/sdk
yarn add @comfyorg/sdk
```

To build from source instead (for local development, or to track an unreleased
commit):

```bash
git clone https://github.com/Comfy-Org/comfy-typescript-sdk
cd comfy-typescript-sdk
pnpm install
pnpm build          # tsc -> dist/, reference the built dist/
```

`pnpm install` already brings in everything needed to lint/type-check/test
locally.

### For local

The SDK works against a ComfyUI instance with **Comfy API v2**. Comfy Cloud and serverless instances deployed from our developer platform already use Comfy API v2. For local or self-hosted instances, **Comfy API v2** can be setup using the [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy).

## Getting started

```ts
import { Comfy } from "@comfyorg/sdk";

const client = new Comfy("http://127.0.0.1:8189"); // Self-hosted, no API key
// const client = new Comfy({ apiKey: "comfyui-..." }); // Comfy Cloud

const wf = await client.workflows.fromFile("workflow_api.json");

// Input assets are hashed locally with blake3
// If the server already has an identical copy we reuse it, if not we upload the asset
// The workflow is updated with the core/ASSET reference instead of a local file path
const asset = client.assets.fromFile("photo.png");
wf.setInput("10", "image", asset);

// Run workflow
// Get outputs using the output node Id as a reference
const job = await client.run(wf);
for (const output of job.getOutputs("9")) {
  await output.toFile(output.name);
}
```

`run()` submits and polls to completion in one call. If you want to act on
the job in between (read `job.status`, stream progress, cancel it), use
`submit()` and drive the job yourself:

```ts
const job = await client.submit(wf);
await job.wait(); // poll to terminal (adaptive backoff); or call job.refresh() yourself
console.log(job.status, job.outputs);
```

## Authentication — one client, per-surface key

| Surface                                    | Example base URL                                        | `apiKey`                               |
| ------------------------------------------ | ------------------------------------------------------- | -------------------------------------- |
| Self-hosted ComfyUI (behind the API proxy) | `http://127.0.0.1:8189`                                 | Omit — no key is sent, even implicitly |
| Comfy Cloud                                | `https://cloud.comfy.org` — the default, may be omitted | Required                               |
| Serverless deployment                      | `https://<deployment>.comfy.org`                        | Required                               |

```ts
const client = new Comfy({ apiKey: "comfyui-..." }); // Comfy Cloud (default)
const client = new Comfy("http://127.0.0.1:8189"); // Self-hosted
const client = new Comfy("https://<deployment>.comfy.org", { apiKey: "comfyui-..." }); // Serverless
```

There is a single async client — no separate sync/async API, JavaScript is
async-native. A key is only ever attached to requests aimed at the configured
`baseUrl`'s own origin — a server-returned follow-up link (a job's
`events`/`cancel` link, or a redirected asset download) pointing anywhere else
never receives it.

The SDK identifies itself via a `User-Agent` header (for support and usage
analytics) — this is request metadata only; no other data is collected. Pass
`clientInfo: "my-app"` to append an `app/my-app` token so an integration can
attribute its own traffic:

```ts
const client = new Comfy({ apiKey: "comfyui-...", clientInfo: "my-app" });
```

## Partner (API) node auth

Workflows that use partner/API nodes (Gemini, etc.) need a Comfy API key to
authenticate them. Pass it per submit with `apiKey`. This is **not** the same as
the `apiKey` you construct `Comfy` with: the constructor key authenticates _you_
to the server, while this one authenticates the partner nodes _inside_ the
workflow (it is often the same `comfyui-…` key):

```ts
const job = await client.run(wf, { apiKey: "comfyui-..." });
// or drive it yourself:
const job = await client.submit(wf, { apiKey: "comfyui-..." });
```

The SDK sends it once as `extra_data.api_key_comfy_org` alongside the workflow —
one key authenticates every partner node in the graph. It is never logged or
persisted by the SDK. Omit `apiKey` and no `extra_data` is sent at all.

## Assets and `core/ASSET`

`client.assets.fromFile(...)` / `fromBytes(...)` / `fromStream(...)` /
`fromUrl(...)` return a **lazy** asset handle immediately — no network call
yet. Embed it directly into the workflow graph:

```ts
const asset = client.assets.fromFile("photo.png");
wf.setInput("10", "image", asset);
```

On first use (submitting the workflow, or an explicit `asset.commit()`), the
SDK:

1. hashes the bytes locally with blake3, via
   [`hash-wasm`](https://www.npmjs.com/package/hash-wasm) — pure WebAssembly,
   no native addon;
2. probes the server's dedup fast-path — a `HEAD` existence check by hash,
   then a cheap `from-hash` mint if the server already has those bytes;
3. only streams a full multipart upload on a miss.

At submit time, every asset handle found anywhere in the graph is replaced by
a `core/ASSET` reference object (`{ __type: "core/ASSET", info: { id, hash,
file_path } }`), which the server resolves back to the uploaded asset when it
runs the workflow. Re-running a script against unchanged files re-uploads
nothing.

`client.assets` also has `get(assetId)`, to rehydrate a handle for an asset
that is already committed — see the type definitions for details.

## Live progress

`job.events()` is a typed, auto-reconnecting async iterator over the job's
live event stream:

```ts
const job = await client.submit(wf);
for await (const event of job.events()) {
  // SSE; live, auto-reconnecting (no replay)
  switch (event.kind) {
    case "progress":
      console.log(event.value);
      break;
    case "outputReady":
      await event.output.toFile(`partial/${event.output.name}`);
      break;
    case "statusChange":
      if (event.status === "succeeded") break;
  }
}
```

`job.events()` reconnects automatically if the stream drops, but never
replays a frame you've already seen (the stream carries no cursor). That's
why polling stays authoritative: `job.wait()` (and `client.run()`, which is
`submit()` + `wait()`) always fall back to `GET /jobs/{id}` to decide when a
job is really done — use `events()` for live UI feedback, and `wait()`/`run()`
for the definitive answer. Even `events()` falls back to that poll if the
stream is throttled, drops permanently, or never connects, so consumers never
hang waiting on a stream that isn't coming back. `job.status` is the current
status string; `job.outputs` is the full list of output handles regardless of
which node produced them (`job.getOutputs(nodeId)` filters to one node, as in
the quickstart above).

## Cancellation and timeouts

`submit`, `run`, `wait`, `events`, and `cancel` all accept an `AbortSignal`,
which stops both the in-flight request _and_ any internal wait (the queue-full
retry pause, the poll backoff, the SSE reconnect pause) — an abort takes
effect immediately rather than only after the current network call returns:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000); // give up after 30s

const job = await client.submit(wf, { signal: controller.signal });
await job.wait(undefined, controller.signal);
```

`run()` also takes a plain `timeoutMs` if you just want a deadline without
managing an `AbortController` yourself:

```ts
await client.run(wf, { timeoutMs: 60_000 });
```

## Downloading outputs

A finished job exposes its results as `Output` handles — `job.outputs`, or
`job.getOutputs(nodeId)` to filter to one node. Each output is an asset you
can pull down whichever way suits the caller:

```ts
const out = job.getOutputs("13")[0];
await out.toFile("result.png"); // stream to disk in chunks
const data = await out.toBytes(); // buffer into memory
await out.toFile("head.png", { range: [0, 1023] }); // range-aware: first 1 KiB only
```

`getDownloadUrl()` hands back a fetchable URL instead of transferring the
bytes through your process — give it to a browser, a CDN, or another service:

```ts
const { url, expiresAt } = await out.getDownloadUrl();
```

On Comfy Cloud / serverless the URL is a short-lived, **self-authorizing**
signed storage URL: whoever holds it can read the asset until `expiresAt`
with no API key of their own. On a self-hosted proxy it's the content endpoint
(normal auth still applies) and `expiresAt` is `null`. It works on every
backend and never downloads the bytes first.

## Typed errors

`@comfyorg/sdk` translates the API's error envelope into a small set of
exceptions, all importable from the top-level package and all subclasses of
`ComfyError` (`code`, `httpStatus`, `details`):

- `Unauthorized`, `Forbidden`, `NotFound` — auth and lookup failures.
- `InvalidWorkflow`, `WorkflowFormatUi` — the graph itself was rejected;
  `WorkflowFormatUi` specifically means a UI-export (`nodes`/`links`/
  `last_node_id`) was submitted instead of the API-format graph — the SDK
  catches this locally before it ever reaches the server.
- `MissingAsset` — a `core/ASSET` reference could not be resolved.
- `HashMismatch`, `BlobNotFound` — asset upload/dedup failures.
- `IdempotencyKeyReuse` — the `Idempotency-Key` was reused. `submit()` (and
  `run()`) attach a fresh key to every call, so an accidental exact resend never
  runs the workflow twice. Keys are single-use — reject-on-duplicate, there is
  no replay — so if you pass your own `idempotencyKey` and reuse it, the second
  call throws this. After an ambiguous failure (e.g. a timeout where you don't
  know if the job was created), poll or list your jobs rather than resubmitting
  with the same key.
- `InsufficientCredits` — the account can't afford the job.
- `QueueFull` — backpressure; carries `retryAfter` seconds. `client.submit`
  already retries this automatically for a bounded budget before giving up
  and throwing it.
- `JobFailed` — a job reached a non-`succeeded` terminal state; `error`
  carries node-level detail when the platform provided one.

```ts
import { JobFailed, MissingAsset } from "@comfyorg/sdk";

try {
  await client.run(wf);
} catch (err) {
  if (err instanceof JobFailed) {
    console.error(err.error); // { code, message, node_id, class_type, traceback } | null
  } else if (err instanceof MissingAsset) {
    console.error("asset reference was not usable:", err.details);
  } else {
    throw err;
  }
}
```

## Architecture — two layers

- **`@comfyorg/sdk/low`** — generated protocol bindings. Types and
  [Zod](https://zod.dev) schemas generated from `spec/openapi.yaml`
  (`src/low/generated/*`, committed; regenerate with `pnpm generate`, CI fails
  on drift) plus a thin hand-written `fetch` transport (`ComfyLow`), one method
  per API operation, with the mandatory escape hatches: raw `Response` access,
  unbuffered/streaming bodies (for SSE and range downloads), a streaming
  multipart upload body, and per-request `AbortSignal`/timeout. Boring and
  replaceable.

- **`@comfyorg/sdk`** — the idiomatic layer integrators import. This is where
  the value lives: blake3 content-addressed dedup-upload, `core/ASSET`
  substitution, idempotent submit with queue-full backoff, live SSE with
  reconnect, poll-authoritative `run()`, range-aware downloads, and typed
  exceptions mapping the error envelope.

The generated part of `low` is produced by
[`@hey-api/openapi-ts`](https://heyapi.dev). `spec/openapi.yaml` is a one-way
vendored copy of the canonical Comfy API v2 contract — do not hand-edit it
(see `spec/README.md`). It's synced periodically from that canonical contract,
stripped of anything tagged `internal`, and pinned by `spec/VERSION`.

## Related projects

Clients for the same Comfy API v2 contract:

| Project                                                                   | Language   | Package         |
| ------------------------------------------------------------------------- | ---------- | --------------- |
| [comfy-python-sdk](https://github.com/Comfy-Org/comfy-python-sdk)         | Python     | `comfy-sdk`     |
| [comfy-typescript-sdk](https://github.com/Comfy-Org/comfy-typescript-sdk) | TypeScript | `@comfyorg/sdk` |

[comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy) fronts a
self-hosted ComfyUI with this same v2 contract (it is the `comfy-api-proxy`
entry in the `servers` list of `spec/openapi.yaml`).

## Development

```bash
pnpm install --frozen-lockfile
pnpm lint             # oxlint
pnpm format:check     # oxfmt --check
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm build            # tsc -> dist/
```

Regenerating and checking the vendored protocol layer (a separate CI job):

```bash
pnpm generate         # regenerate src/low/generated/* from spec/openapi.yaml
pnpm check:spec-drift # same check CI runs; fails if generated code drifted from the spec
```

Other useful scripts:

```bash
pnpm format           # oxfmt --write
pnpm test:coverage    # vitest run --coverage
```

## Releases

Releases are published to npm from a GitHub Release (tag `vX.Y.Z`) by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml).
