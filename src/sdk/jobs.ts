/**
 * Job handles — the resumable, poll-authoritative core of the SDK.
 *
 * A {@link Job} is rehydratable purely from its ID. `wait` polls
 * `GET /api/v2/jobs/{id}` with adaptive backoff as the source of truth for
 * terminal status and outputs, so a stream that is throttled, dropped, or
 * permanently unavailable never stalls completion. `events` is the live SSE
 * stream on top: typed, auto-reconnecting (no replay — the stream carries
 * no cursor), with the poll path as its backstop. Mirrors `comfy_sdk.jobs`
 * in the Python SDK — one async class since JS is async-native.
 */

import type { ComfyLow, Job as LowJob, Output as LowOutput } from "../low/index.js";
import { abortableSleep } from "./abortable-sleep.js";
import { backoffSchedule, isTerminal, SUCCESS } from "./core.js";
import { eventFromRaw, type ComfyEvent, type StatusChange } from "./events.js";
import { JobFailed, translate } from "./exceptions.js";
import { Output } from "./outputs.js";

// Pause before reconnecting an SSE stream that dropped mid-job, without a
// terminal frame having been seen.
const RECONNECT_PAUSE_MS = 100;

export class Job {
  private readonly low: ComfyLow;
  private model: LowJob;

  constructor(low: ComfyLow, model: LowJob) {
    this.low = low;
    this.model = model;
  }

  get id(): string {
    return this.model.id;
  }

  get status(): string {
    return this.model.status;
  }

  get outputs(): Output[] {
    return this.model.outputs.map((o) => this.bindOutput(o));
  }

  get error(): LowJob["error"] {
    return this.model.error;
  }

  getOutputs(nodeId: string): Output[] {
    return this.model.outputs.filter((o) => o.node_id === nodeId).map((o) => this.bindOutput(o));
  }

  private bindOutput(model: LowOutput): Output {
    return new Output(model, this.low);
  }

  /** Poll `GET /api/v2/jobs/{id}` once and adopt the fresh state. */
  async refresh(signal?: AbortSignal): Promise<this> {
    this.model = await translate(() =>
      this.low.getJob(this.model.urls.self || this.model.id, { signal }),
    );
    return this;
  }

  /** Poll to a terminal state (adaptive backoff). Rejects with a
   * `TimeoutError` if `timeoutMs` elapses first, or immediately if `signal`
   * aborts — the abort interrupts the backoff wait itself, not just the
   * in-flight poll request. */
  async wait(timeoutMs?: number, signal?: AbortSignal): Promise<this> {
    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    const backoff = backoffSchedule();
    for (;;) {
      await this.refresh(signal);
      if (isTerminal(this.status)) return this;
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new Error(`job ${this.id} not terminal after ${timeoutMs}ms (status=${this.status})`);
      }
      await abortableSleep(backoff.next().value, signal);
    }
  }

  /** Wait for terminal, then throw `JobFailed` unless it succeeded. */
  async result(signal?: AbortSignal): Promise<this> {
    await this.wait(undefined, signal);
    if (this.status !== SUCCESS) {
      throw new JobFailed(`job ${this.id} ended ${this.status}`, { error: this.model.error });
    }
    return this;
  }

  async cancel(signal?: AbortSignal): Promise<this> {
    this.model = await translate(() =>
      this.low.cancelJob(this.model.urls.cancel || this.model.id, { signal }),
    );
    return this;
  }

  /**
   * Typed live event iterator. Auto-reconnects with no replay; falls back
   * to polling to detect terminal status if the stream ends early. An
   * aborted `signal` stops both the current SSE connection/poll and the
   * pause between reconnect attempts.
   */
  async *events(signal?: AbortSignal): AsyncGenerator<ComfyEvent, void, void> {
    const eventsUrl = this.model.urls.events || this.model.id;
    for (;;) {
      let terminalSeen = false;
      try {
        for await (const raw of this.low.getJobEvents(eventsUrl, { signal })) {
          const event = eventFromRaw(raw, (data) => this.bindOutput(data as unknown as LowOutput));
          if (event === null) continue;
          if (event.kind === "statusChange" && isTerminal(event.status)) {
            terminalSeen = true;
            yield event;
            return;
          }
          yield event;
        }
      } catch (exc) {
        // A caller abort must propagate (and stop the loop), not be
        // swallowed as an ordinary mid-stream drop.
        if (signal?.aborted) throw exc;
        // Connection dropped mid-stream — reconnect below.
      }
      if (terminalSeen) return;
      // Stream ended without a terminal frame. Poll the authoritative
      // state: stop if already terminal, else reconnect for fresh frames.
      await this.refresh(signal);
      if (isTerminal(this.status)) {
        const statusChange: StatusChange = {
          kind: "statusChange",
          status: this.status,
          queuePosition: null,
        };
        yield statusChange;
        return;
      }
      await abortableSleep(RECONNECT_PAUSE_MS, signal);
    }
  }
}

export class JobFactory {
  private readonly low: ComfyLow;

  constructor(low: ComfyLow) {
    this.low = low;
  }

  async get(jobId: string): Promise<Job> {
    return new Job(this.low, await translate(() => this.low.getJob(jobId)));
  }
}
