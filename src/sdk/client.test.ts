import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StubServer } from "../../test/support/stub-server.js";
import { Comfy } from "./client.js";
import { QueueFull, WorkflowFormatUi } from "./exceptions.js";

describe("Comfy", () => {
  let server: StubServer;
  let client: Comfy;

  beforeEach(async () => {
    server = new StubServer();
    await server.start();
    client = new Comfy(server.baseUrl);
  });

  afterEach(async () => {
    await server.stop();
  });

  it("rejects a UI-format workflow before any network call", async () => {
    const wf = client.workflows.fromJson({ nodes: [], links: [], last_node_id: 0 });
    await expect(client.submit(wf)).rejects.toBeInstanceOf(WorkflowFormatUi);
    expect(server.state.submitCount).toBe(0);
  });

  it("substitutes an asset handle into a core/ASSET reference on submit", async () => {
    const wf = client.workflows.fromJson({ "1": { inputs: {} } });
    const asset = client.assets.fromBytes(new Uint8Array([1, 2, 3]), { filename: "in.png" });
    wf.setInput("1", "image", asset);

    await client.submit(wf);

    const submitted = server.state.lastWorkflow as Record<string, { inputs: { image: unknown } }>;
    expect(submitted["1"].inputs.image).toEqual({
      __type: "core/ASSET",
      info: { id: asset.id, hash: expect.any(String), file_path: "in.png" },
    });
  });

  it("run() submits and polls to completion end-to-end", async () => {
    server.state.pollsToSucceed = 2;
    const wf = client.workflows.fromJson({ "1": {} });
    const job = await client.run(wf);
    expect(job.status).toBe("succeeded");
    const outputs = job.getOutputs("13");
    expect(outputs).toHaveLength(1);
  });

  it("submit() retries a queue_full response using Retry-After, transparently", async () => {
    server.state.queueFullTimes = 2;
    const wf = client.workflows.fromJson({ "1": {} });
    const job = await client.submit(wf);
    expect(job.status).toBe("queued");
    expect(server.state.submitCount).toBe(3); // 2 queue_full + 1 success
  });

  it("submit() is idempotent: a retried submit with the same key replays the job", async () => {
    const wf = client.workflows.fromJson({ "1": {} });
    const key = "same-key-please";
    const first = await client.submit(wf, { idempotencyKey: key });
    const second = await client.submit(wf, { idempotencyKey: key });
    expect(second.id).toBe(first.id);
  });

  it("propagates job_error as a typed, non-QueueFull error immediately", async () => {
    server.state.jobError = { status: 422, code: "invalid_workflow" };
    const wf = client.workflows.fromJson({ "1": {} });
    await expect(client.submit(wf)).rejects.not.toBeInstanceOf(QueueFull);
    expect(server.state.submitCount).toBe(1); // no retry loop for a non-queue_full error
  });

  it("downloads a byte range of an output", async () => {
    server.state.contentBytes = Buffer.from("abcdefghij");
    server.state.pollsToSucceed = 1;
    const wf = client.workflows.fromJson({ "1": {} });
    const job = await client.run(wf);
    const bytes = await job.getOutputs("13")[0].toBytes({ range: [0, 3] });
    expect(Buffer.from(bytes).toString()).toBe("abcd");
  });
});
