/**
 * Follow-up links (`job.urls.*`) resolve against the origin, not baseUrl.
 *
 * A server mounts the v2 contract wherever it likes — the serverless gateway
 * serves it under `/deployment/{id}/api/v2` — and its host-relative follow-up
 * links already include that mount prefix. Resolving them against `baseUrl`
 * (which carries the same prefix) doubles it and 404s; they must resolve
 * against the scheme+authority only. Internal shorthand paths (`/jobs/…`,
 * `/assets…`) keep resolving under `baseUrl` + `/api/v2`.
 */

import { describe, expect, it } from "vitest";

import { ComfyLow } from "./transport.js";

const GATEWAY_BASE = "https://stagingplatformapi.comfy.org/deployment/dep_123";

function jobJson(id: string, urlsPrefix: string) {
  return {
    id,
    status: "queued",
    created_at: "2026-07-10T18:20:00Z",
    started_at: null,
    completed_at: null,
    expires_at: "2026-07-11T18:20:00Z",
    queue_position: 0,
    progress: null,
    outputs: [],
    error: null,
    metrics: null,
    urls: {
      self: `${urlsPrefix}/api/v2/jobs/${id}`,
      events: `${urlsPrefix}/api/v2/jobs/${id}/events`,
      cancel: `${urlsPrefix}/api/v2/jobs/${id}/cancel`,
    },
  };
}

function capturingLow(baseUrl: string, apiKey?: string) {
  const requests: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    requests.push({ url, auth: headers.get("Authorization") });
    return new Response(JSON.stringify(jobJson("j1", "/deployment/dep_123")), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { low: new ComfyLow(baseUrl, apiKey, { fetch: fetchImpl }), requests };
}

describe("follow-up link resolution", () => {
  it("resolves a gateway self link against the origin, not baseUrl", async () => {
    const { low, requests } = capturingLow(GATEWAY_BASE, "comfyui-k");
    await low.getJob("/deployment/dep_123/api/v2/jobs/j1");
    expect(requests[0].url).toBe(
      "https://stagingplatformapi.comfy.org/deployment/dep_123/api/v2/jobs/j1",
    );
  });

  it("keeps the deployment prefix for internal shorthand paths", async () => {
    const { low, requests } = capturingLow(GATEWAY_BASE, "comfyui-k");
    await low.getJob("j1");
    expect(requests[0].url).toBe(`${GATEWAY_BASE}/api/v2/jobs/j1`);
  });

  it("leaves bare-surface self links unchanged", async () => {
    const { low, requests } = capturingLow("https://cloud.comfy.org", "comfyui-k");
    await low.getJob("/api/v2/jobs/j1");
    expect(requests[0].url).toBe("https://cloud.comfy.org/api/v2/jobs/j1");
  });

  it("still attaches auth to origin-resolved links", async () => {
    const { low, requests } = capturingLow(GATEWAY_BASE, "comfyui-k");
    await low.getJob("/deployment/dep_123/api/v2/jobs/j1");
    expect(requests[0].auth).toBe("Bearer comfyui-k");
  });
});
