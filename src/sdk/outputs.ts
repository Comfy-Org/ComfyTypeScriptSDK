/**
 * Output handles — typed, range-aware download over an asset id.
 *
 * An output is an asset: the bytes are retrievable via `getAssetContent`
 * (which serves directly or redirects to a signed URL) for as long as the
 * job is retained. `toFile` streams to disk; `toBytes` buffers. Mirrors
 * `comfy_sdk.outputs` in the Python SDK.
 */

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ComfyLow, Output as LowOutput } from "../low/index.js";

export class Output {
  private readonly model: LowOutput;
  private readonly low: ComfyLow;

  constructor(model: LowOutput, low: ComfyLow) {
    this.model = model;
    this.low = low;
  }

  get nodeId(): string {
    return this.model.node_id;
  }

  get name(): string {
    return this.model.name;
  }

  get type(): LowOutput["type"] {
    return this.model.type;
  }

  get id(): string {
    return this.model.id;
  }

  get sizeBytes(): number {
    return this.model.size_bytes;
  }

  get contentType(): string {
    return this.model.content_type;
  }

  async toFile(path: string, options: { range?: readonly [number, number] } = {}): Promise<string> {
    const response = await this.low.getAssetContent(this.model.id, { range: options.range });
    if (!response.body) throw new Error(`empty response body for asset ${this.model.id}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
    return path;
  }

  async toBytes(options: { range?: readonly [number, number] } = {}): Promise<Uint8Array> {
    const response = await this.low.getAssetContent(this.model.id, { range: options.range });
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * A directly-fetchable URL for this output's bytes — a short-lived,
   * self-authorizing bearer credential (readable until `expiresAt`) — so a
   * caller (e.g. a serverless/Cloudflare Worker) can hand the URL to a
   * downstream consumer instead of streaming the bytes through itself. On an
   * object-storage backend (Cloud/serverless) this is a signed URL and
   * `expiresAt` is set; on a self-hosted proxy (which serves the bytes
   * inline) it's this asset's own content URL and `expiresAt` is `null`.
   * Works on every backend and never throws.
   */
  async getDownloadUrl(): Promise<{ url: string; expiresAt: Date | null }> {
    return this.low.getAssetContentUrl(this.model.id);
  }
}
