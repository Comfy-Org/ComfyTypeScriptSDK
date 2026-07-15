# @comfyorg/sdk (TypeScript)

TypeScript SDK for running ComfyUI workflows via the **Comfy API v2** — the
same code against a self-hosted ComfyUI (through `comfy-api-proxy`), Comfy
Cloud, or a serverless deployment, changing only the base URL and key.

This mirrors the shape of the [Python SDK](https://github.com/Comfy-Org/ComfyPythonSDK)
(`comfy-sdk`): submit a workflow, wait for it, download the outputs.

```ts
import { Comfy } from '@comfyorg/sdk'

const client = new Comfy('http://127.0.0.1:8189') // local proxy
// const client = new Comfy('https://api.comfy.org', { apiKey: '...' }) // Comfy Cloud

const job = await client.run(workflowApiJson)
```

Status: early scaffold. `run()` is currently a stub that throws — this
repository is where CI, tooling, and the package shape get set up first; the
real client implementation (submit / poll / download, matching the Python
SDK's behavior) lands next.

## Development

```bash
pnpm install
pnpm build       # tsc -> dist/
pnpm lint        # oxlint
pnpm format:check  # oxfmt --check
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
```
