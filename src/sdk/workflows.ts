/**
 * Workflow construction and mutation.
 *
 * A {@link Workflow} is a thin, local wrapper over the raw API-format
 * graph. The graph stays a freely-mutable object (`wf.json`); `setInput` is
 * sugar for `wf.json[node].inputs[field] = value` that also accepts an
 * asset handle (substituted into a `core/ASSET` object at submit time).
 * Construction does no network I/O in v1. Mirrors `comfy_sdk.workflows` in
 * the Python SDK.
 */

import { readFile } from "node:fs/promises";

export type WorkflowGraph = Record<string, unknown>;

export class Workflow {
  json: WorkflowGraph;

  constructor(graph: WorkflowGraph) {
    this.json = graph;
  }

  /**
   * Set `node.inputs.field`. `value` may be a plain JSON value or an asset
   * handle; handles are substituted into `core/ASSET` objects when the
   * workflow is submitted.
   */
  setInput(nodeId: string, field: string, value: unknown): void {
    const node = (this.json[nodeId] ??= {}) as Record<string, unknown>;
    const inputs = (node.inputs ??= {}) as Record<string, unknown>;
    inputs[field] = value;
  }
}

/**
 * `client.workflows` — alternative constructors for {@link Workflow}.
 * Namespaced on the client (rather than free-standing) because
 * construction is expected to become client-bound once server-side
 * subgraphs land; in v1 it is purely local.
 */
export class WorkflowFactory {
  async fromFile(path: string): Promise<Workflow> {
    const text = await readFile(path, "utf-8");
    return new Workflow(JSON.parse(text) as WorkflowGraph);
  }

  fromJson(graph: WorkflowGraph): Workflow {
    return new Workflow(graph);
  }

  fromString(text: string): Workflow {
    return new Workflow(JSON.parse(text) as WorkflowGraph);
  }
}
