import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StubServer } from "../../test/support/stub-server.js";
import { ComfyLow } from "../low/index.js";
import { JobFailed } from "./exceptions.js";
import { JobFactory } from "./jobs.js";

describe("Job", () => {
  let server: StubServer;
  let jobs: JobFactory;
  let low: ComfyLow;

  beforeEach(async () => {
    server = new StubServer();
    await server.start();
    low = new ComfyLow(server.baseUrl);
    jobs = new JobFactory(low);
  });

  afterEach(async () => {
    await server.stop();
  });

  it("result() polls to a terminal state without ever touching SSE", async () => {
    server.state.pollsToSucceed = 3;
    const job = await jobs.get("job_01");
    await job.result();
    expect(job.status).toBe("succeeded");
    expect(job.outputs).toHaveLength(1);
    expect(server.state.jobPollCount).toBeGreaterThanOrEqual(3);
    expect(server.state.eventsConnectCount).toBe(0);
  });

  it("result() throws JobFailed for a non-success terminal state", async () => {
    server.state.terminalStatus = "failed";
    const job = await jobs.get("job_01");
    await expect(job.result()).rejects.toBeInstanceOf(JobFailed);
  });

  it("cancel() moves the job to canceling", async () => {
    const job = await jobs.get("job_01");
    await job.cancel();
    expect(job.status).toBe("canceling");
  });

  it("events() consumes the full typed SSE frame sequence to terminal", async () => {
    const job = await jobs.get("job_01");
    const kinds: string[] = [];
    for await (const event of job.events()) {
      kinds.push(event.kind);
    }
    expect(kinds).toEqual(["statusChange", "progress", "outputReady", "statusChange"]);
  });

  it("events() reconnects after a mid-stream drop without replaying old frames", async () => {
    server.state.sseMode = "reconnect";
    server.state.pollsToSucceed = 100; // never resolves via poll during the gap
    const job = await jobs.get("job_01");
    const progressValues: number[] = [];
    let terminal = false;
    for await (const event of job.events()) {
      if (event.kind === "progress") progressValues.push(event.value);
      if (event.kind === "statusChange" && event.status === "succeeded") terminal = true;
    }
    expect(terminal).toBe(true);
    // Exactly one 0.4 from the dropped first connection, one 0.5 from the
    // second — no duplicate/replayed frame from the connection that dropped.
    expect(progressValues).toEqual([0.4, 0.5]);
    expect(server.state.eventsConnectCount).toBe(2);
  });
});
