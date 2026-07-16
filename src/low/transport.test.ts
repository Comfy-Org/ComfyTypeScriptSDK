import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StubServer } from "../../test/support/stub-server.js";
import { BlobNotFound, HashMismatch, Unauthorized } from "./errors.js";
import { ComfyLow } from "./transport.js";

describe("ComfyLow transport", () => {
  let server: StubServer;
  let low: ComfyLow;

  beforeEach(async () => {
    server = new StubServer();
    await server.start();
    low = new ComfyLow(server.baseUrl);
  });

  afterEach(async () => {
    await server.stop();
  });

  it("headAssetByHash reflects known/unknown hashes", async () => {
    server.state.knownHashes.add("blake3:known");
    await expect(low.headAssetByHash("blake3:known")).resolves.toBe(true);
    await expect(low.headAssetByHash("blake3:unknown")).resolves.toBe(false);
    expect(server.state.headCount).toBe(2);
  });

  it("assetFromHash dedup-mints over an existing blob", async () => {
    server.state.knownHashes.add("blake3:known");
    const asset = await low.assetFromHash("blake3:known", { filePath: "a.png" });
    expect(asset.id).toBe("asset_dedup_01");
    expect(server.state.fromHashCount).toBe(1);
  });

  it("assetFromHash misses with blob_not_found -> BlobNotFound", async () => {
    await expect(low.assetFromHash("blake3:missing")).rejects.toBeInstanceOf(BlobNotFound);
  });

  it("postAssets streams a file from disk without buffering it whole", async () => {
    const dir = await mkdtemp(join(tmpdir(), "comfy-sdk-"));
    const path = join(dir, "big.bin");
    // Large enough that a single-chunk upload would be suspicious, small
    // enough to keep the test fast.
    const size = 4 * 1024 * 1024;
    await writeFile(path, Buffer.alloc(size, 7));
    try {
      const { openAsBlob } = await import("node:fs");
      const blob = await openAsBlob(path);
      expect(blob.size).toBe(size); // the Blob is disk-backed, not pre-read
      const asset = await low.postAssets(blob, "application/octet-stream", "big.bin", {
        expectedHash: "blake3:whatever",
      });
      expect(asset.created_new).toBe(true);
      // The server saw more than one TCP `data` event for a 4MB body —
      // consistent with a streamed (not single-buffer) transfer.
      expect(server.state.uploadDataEvents).toBeGreaterThan(1);
      expect(server.state.lastUploadContentLength).toBeGreaterThan(size);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("postAssets surfaces hash_mismatch without a blind retry", async () => {
    server.state.rejectHashMismatch = true;
    await expect(
      low.postAssets(new Blob(["x"]), "text/plain", "a.txt", { expectedHash: "blake3:wrong" }),
    ).rejects.toBeInstanceOf(HashMismatch);
    expect(server.state.uploadCount).toBe(1); // exactly one attempt, no retry
  });

  it("getAssetContent supports Range requests", async () => {
    server.state.contentBytes = Buffer.from("0123456789");
    const response = await low.getAssetContent("asset_1", { range: [2, 4] });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("234");
  });

  it("postJobs replays the same response for a repeated Idempotency-Key", async () => {
    const key = "idem-key-1";
    const first = await low.postJobs({ "1": {} }, { idempotencyKey: key });
    const second = await low.postJobs({ "1": {} }, { idempotencyKey: key });
    expect(first.job.id).toBe(second.job.id);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
  });

  it("getJob polls the authoritative state (no SSE involved)", async () => {
    server.state.pollsToSucceed = 3;
    let job = await low.getJob("job_01");
    expect(job.status).toBe("running");
    job = await low.getJob("job_01");
    expect(job.status).toBe("running");
    job = await low.getJob("job_01");
    expect(job.status).toBe("succeeded");
    expect(job.outputs).toHaveLength(1);
    expect(server.state.eventsConnectCount).toBe(0);
  });

  it("getJobEvents decodes the raw SSE frames", async () => {
    const events: string[] = [];
    for await (const event of low.getJobEvents("job_01")) {
      events.push(event.event);
    }
    expect(events).toEqual(["status", "progress", "output", "status"]);
  });

  it("cancelJob returns the canceling state", async () => {
    const job = await low.cancelJob("job_01");
    expect(job.status).toBe("canceling");
  });

  // -- per-surface auth (FIX 3) ---------------------------------------------

  it("a request with no apiKey against a no-auth server sends no Authorization header", async () => {
    await low.getJob("job_01");
    expect(server.state.lastAuthorizationHeader).toBeNull();
  });

  it("a request with no apiKey against a server requiring auth gets a typed Unauthorized", async () => {
    server.state.requireAuth = true;
    await expect(low.getJob("job_01")).rejects.toBeInstanceOf(Unauthorized);
  });

  it("a request with an apiKey sends Authorization: Bearer <key>, and the server receives it", async () => {
    server.state.requireAuth = true;
    const authed = new ComfyLow(server.baseUrl, "secret-key-123");
    await authed.getJob("job_01");
    expect(server.state.lastAuthorizationHeader).toBe("Bearer secret-key-123");
  });

  // -- cross-origin bearer-token leak (FIX 1) -------------------------------

  it("does not attach the bearer token to a server-supplied cross-origin urls.self/events/cancel", async () => {
    const authed = new ComfyLow(server.baseUrl, "top-secret-key");
    const attacker = new StubServer();
    await attacker.start();
    try {
      // The primary server hands back absolute job links pointing at a
      // different origin (e.g. a relay/CDN) instead of a relative path.
      server.state.jobUrlsOrigin = attacker.baseUrl;

      const job = await authed.getJob("job_01");
      expect(job.urls.self.startsWith(attacker.baseUrl)).toBe(true);
      // Same-origin request (to the primary server itself): the key IS sent.
      expect(server.state.lastAuthorizationHeader).toBe("Bearer top-secret-key");

      // Following the server-supplied absolute `urls.self` crosses origins —
      // the key must NOT follow it there.
      await authed.getJob(job.urls.self);
      expect(attacker.state.lastAuthorizationHeader).toBeNull();

      // Same for the SSE stream URL.
      for await (const _event of authed.getJobEvents(job.urls.events)) {
        // drain
      }
      expect(attacker.state.lastAuthorizationHeader).toBeNull();

      // And for cancel.
      await authed.cancelJob(job.urls.cancel);
      expect(attacker.state.lastAuthorizationHeader).toBeNull();
    } finally {
      await attacker.stop();
    }
  });
});
