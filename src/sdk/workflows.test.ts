import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Workflow, WorkflowFactory } from "./workflows.js";

describe("Workflow / WorkflowFactory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "comfy-sdk-wf-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fromJson wraps the graph as-is", () => {
    const wf = new WorkflowFactory().fromJson({ "1": { inputs: {} } });
    expect(wf).toBeInstanceOf(Workflow);
    expect(wf.json).toEqual({ "1": { inputs: {} } });
  });

  it("fromString parses JSON text", () => {
    const wf = new WorkflowFactory().fromString('{"1":{"inputs":{"seed":1}}}');
    expect(wf.json).toEqual({ "1": { inputs: { seed: 1 } } });
  });

  it("fromFile reads and parses a workflow JSON file", async () => {
    const path = join(dir, "workflow_api.json");
    await writeFile(path, JSON.stringify({ "2": { inputs: {} } }));
    const wf = await new WorkflowFactory().fromFile(path);
    expect(wf.json).toEqual({ "2": { inputs: {} } });
  });

  it("setInput creates node/inputs objects as needed and accepts any value", () => {
    const wf = new Workflow({});
    wf.setInput("5", "text", "hello");
    expect(wf.json).toEqual({ "5": { inputs: { text: "hello" } } });
    wf.setInput("5", "seed", 42);
    expect(wf.json).toEqual({ "5": { inputs: { text: "hello", seed: 42 } } });
  });
});
