import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StubServer } from "../../test/support/stub-server.js";
import { ComfyLow } from "../low/index.js";
import { Output } from "./outputs.js";

describe("Output", () => {
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

  function output(): Output {
    return new Output(
      {
        node_id: "13",
        name: "out.png",
        type: "image",
        content_type: "image/png",
        size_bytes: 10,
        id: "asset_out_01",
        hash: null,
        url: "http://example.invalid/out",
        url_expires_at: "2026-07-10T19:20:00Z",
      },
      low,
    );
  }

  it("exposes the low-level output fields", () => {
    const out = output();
    expect(out.nodeId).toBe("13");
    expect(out.name).toBe("out.png");
    expect(out.type).toBe("image");
    expect(out.id).toBe("asset_out_01");
    expect(out.sizeBytes).toBe(10);
    expect(out.contentType).toBe("image/png");
  });

  it("toFile streams the full content to disk", async () => {
    server.state.contentBytes = Buffer.from("full-output-bytes");
    const dir = await mkdtemp(join(tmpdir(), "comfy-sdk-out-"));
    const path = join(dir, "out.png");
    try {
      await output().toFile(path);
      const written = await readFile(path);
      expect(written.toString()).toBe("full-output-bytes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("toFile honors a byte range", async () => {
    server.state.contentBytes = Buffer.from("0123456789");
    const dir = await mkdtemp(join(tmpdir(), "comfy-sdk-out-"));
    const path = join(dir, "out.bin");
    try {
      await output().toFile(path, { range: [3, 5] });
      const written = await readFile(path);
      expect(written.toString()).toBe("345");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
