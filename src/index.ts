/**
 * Comfy SDK (TypeScript scaffold).
 *
 * Mirrors the shape of the Python SDK (`comfy-sdk`): one client that runs a
 * workflow against any Comfy API v2 surface — the local proxy or Comfy
 * Cloud — changing only the base URL and key.
 *
 * This is a scaffold: the constructor and method signatures are settled so
 * CI, the package shape, and the public export have something real to build
 * and test against, but the request/poll/download logic is not implemented
 * yet. That lands in a follow-up change, matching the Python client's
 * submit -> poll -> download behavior.
 */

export interface ComfyOptions {
  apiKey?: string;
}

export interface Job {
  id: string;
  status: string;
  urls: { self: string };
  outputs?: Array<{ name: string; url: string }>;
  error?: { message?: string };
}

export class Comfy {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(baseUrl: string, options: ComfyOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  /**
   * Submit a workflow, poll until it reaches a terminal state, and return
   * the finished job. Not implemented yet — see the Python SDK
   * (Comfy-Org/ComfyPythonSDK) for the reference behavior this will mirror.
   */
  async run(_workflow: unknown, _timeoutMs = 120_000, _pollMs = 500): Promise<Job> {
    throw new Error("not implemented yet");
  }
}
