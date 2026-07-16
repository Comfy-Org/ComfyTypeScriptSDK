/**
 * `Comfy` — the client integrators import.
 *
 * Runs an API-format workflow against any Comfy API v2 surface (self-hosted
 * proxy, Comfy Cloud, serverless) — the only per-surface difference is the
 * base URL and an optional key — and owns everything a generator cannot
 * produce: local blake3 dedup-upload, `core/ASSET` substitution, idempotent
 * submit, live SSE with a poll-authoritative backstop, range-aware
 * downloads, and typed errors. It is layered over `../low` (the generated
 * types/validators + thin transport).
 *
 * Mirrors `comfy_sdk.client.AsyncComfy` in the Python SDK — there is no
 * separate sync client here (JS is async-native, so the Python SDK's
 * sync/async split collapses to one class).
 *
 * @example
 * ```ts
 * import { Comfy } from "@comfyorg/sdk";
 *
 * const client = new Comfy("http://127.0.0.1:8189"); // self-hosted, no key
 * // const client = new Comfy("https://api.comfy.org", { apiKey: "ck_..." });
 *
 * const wf = await client.workflows.fromFile("workflow_api.json");
 * const asset = client.assets.fromFile("photo.png"); // lazy; uploaded on use
 * wf.setInput("10", "image", asset);
 *
 * const job = await client.run(wf); // submit + poll-to-done
 * (await job.getOutputs("13")[0].toFile("out.png"));
 * ```
 */

import type { AssetReference } from "../low/index.js";
import { ApiError, ComfyLow, type ComfyLowOptions } from "../low/index.js";
import { AssetFactory } from "./assets.js";
import {
  findAssetHandles,
  looksLikeUiFormat,
  newIdempotencyKey,
  substituteAssetHandles,
  SUCCESS,
} from "./core.js";
import type { AssetHandleLike } from "./core.js";
import { JobFailed, QueueFull, WorkflowFormatUi, toSdkError } from "./exceptions.js";
import { Job, JobFactory } from "./jobs.js";
import type { Workflow, WorkflowGraph } from "./workflows.js";
import { WorkflowFactory } from "./workflows.js";

// How long to keep retrying a full queue before giving up (ms).
const QUEUE_RETRY_BUDGET_MS = 60_000;
const DEFAULT_RETRY_AFTER_S = 2;

export interface ComfyOptions {
  apiKey?: string;
  timeoutMs?: number;
  fetch?: ComfyLowOptions["fetch"];
}

function guardUiFormat(workflow: Workflow): void {
  if (looksLikeUiFormat(workflow.json)) {
    throw new WorkflowFormatUi(
      "workflow is in UI-export format (nodes/links/last_node_id); submit the API-format graph instead",
      { code: "workflow_format_ui", httpStatus: 422 },
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Comfy {
  private readonly low: ComfyLow;
  readonly assets: AssetFactory;
  readonly workflows: WorkflowFactory;
  readonly jobs: JobFactory;

  constructor(baseUrl: string, options: ComfyOptions = {}) {
    this.low = new ComfyLow(baseUrl, options.apiKey, {
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    });
    this.assets = new AssetFactory(this.low);
    this.workflows = new WorkflowFactory();
    this.jobs = new JobFactory(this.low);
  }

  private async materialize(workflow: Workflow): Promise<WorkflowGraph> {
    const handles = findAssetHandles(workflow.json);
    const refs = new Map<AssetHandleLike, AssetReference>();
    for (const handle of handles) {
      refs.set(handle, await handle.asReference());
    }
    return substituteAssetHandles(workflow.json, refs) as WorkflowGraph;
  }

  /**
   * Submit a workflow. Auto-generates an idempotency key (so a timed-out
   * submit is safely retryable) and retries `queue_full` with
   * `Retry-After`.
   */
  async submit(workflow: Workflow, options: { idempotencyKey?: string } = {}): Promise<Job> {
    guardUiFormat(workflow);
    const graph = await this.materialize(workflow);
    const key = options.idempotencyKey ?? newIdempotencyKey();
    const deadline = Date.now() + QUEUE_RETRY_BUDGET_MS;
    for (;;) {
      try {
        const { job } = await this.low.postJobs(graph, { idempotencyKey: key });
        return new Job(this.low, job);
      } catch (exc) {
        if (!(exc instanceof ApiError)) throw exc;
        const err = toSdkError(exc);
        if (err instanceof QueueFull && Date.now() < deadline) {
          await sleep((err.retryAfter || DEFAULT_RETRY_AFTER_S) * 1000);
          continue;
        }
        throw err;
      }
    }
  }

  /** Submit, then poll to terminal (authoritative). Throws on failure. */
  async run(workflow: Workflow, options: { timeoutMs?: number } = {}): Promise<Job> {
    const job = await this.submit(workflow);
    return options.timeoutMs === undefined ? job.result() : runWithTimeout(job, options.timeoutMs);
  }
}

async function runWithTimeout(job: Job, timeoutMs: number): Promise<Job> {
  await job.wait(timeoutMs);
  if (job.status !== SUCCESS) {
    throw new JobFailed(`job ${job.id} ended ${job.status}`, { error: job.error });
  }
  return job;
}
