# @comfyorg/sdk (TypeScript)

TypeScript SDK for running ComfyUI workflows via the **Comfy API v2** — the
same code against a self-hosted ComfyUI (through `comfy-api-proxy`), Comfy
Cloud, or a serverless deployment, changing only the base URL and key.

This mirrors the behavior of the [Python SDK](https://github.com/Comfy-Org/ComfyPythonSDK)
(`comfy-sdk`): upload/dedup inputs, submit a workflow, wait for it, download
the outputs — collapsed to a single async client (no separate sync/async
API; JavaScript is async-native).

```ts
import { Comfy } from "@comfyorg/sdk";

const client = new Comfy("http://127.0.0.1:8189"); // local proxy, no key needed
// const client = new Comfy("https://api.comfy.org", { apiKey: "..." }); // Comfy Cloud

const wf = await client.workflows.fromFile("workflow_api.json");
const asset = client.assets.fromFile("photo.png"); // lazy; hashed + uploaded on first use
wf.setInput("10", "image", asset);

const job = await client.run(wf); // submit, then poll to a terminal state
await job.getOutputs("13")[0].toFile("out.png");
```

Live progress, previews, and output-ready notifications are available as a
typed, auto-reconnecting event stream:

```ts
const job = await client.submit(wf);
for await (const event of job.events()) {
  switch (event.kind) {
    case "progress":
      console.log(event.value);
      break;
    case "outputReady":
      await event.output.toFile(`${event.output.name}`);
      break;
    case "statusChange":
      if (event.status === "succeeded") break;
  }
}
```

## Two layers

- **`@comfyorg/sdk`** — the idiomatic client above: asset dedup/upload,
  `core/ASSET` substitution, idempotent submit with queue-full backoff,
  poll-authoritative job completion, typed SSE events, range-aware
  downloads, and typed errors (`JobFailed`, `QueueFull`, `MissingAsset`, ...).
- **`@comfyorg/sdk/low`** — generated types + [Zod](https://zod.dev) schemas
  (`pnpm generate`, from `spec/openapi.yaml`) plus a hand-written `fetch`
  transport (`ComfyLow`) with one method per `operationId` and the escape
  hatches the SDK layer is built on: raw `Response` access, unbuffered
  streaming bodies (for SSE and range downloads), a streaming multipart
  upload body, and per-request `AbortSignal`/timeout. Use this directly if
  you need lower-level control.

## Development

```bash
pnpm install
pnpm generate        # regenerate src/low/generated/* from spec/openapi.yaml
pnpm build            # tsc -> dist/
pnpm lint             # oxlint
pnpm format:check     # oxfmt --check
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm test:coverage    # vitest run --coverage
pnpm check:spec-drift # fails if src/low/generated/* is stale vs. the spec
```

`spec/openapi.yaml` is a vendored, filtered copy of the canonical Comfy API
v2 contract — see `spec/README.md`. Node 22 and 24 only (Node 20 reached
end-of-life; browser support is out of scope for v1).
