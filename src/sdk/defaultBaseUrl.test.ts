import { describe, expect, it } from "vitest";

import { COMFY_CLOUD_BASE_URL, Comfy } from "./index.js";

describe("default baseUrl", () => {
  it("points at Comfy Cloud", () => {
    expect(COMFY_CLOUD_BASE_URL).toBe("https://cloud.comfy.org");
  });

  it("targets Comfy Cloud when constructed with options only", () => {
    expect(new Comfy({ apiKey: "comfyui-test" })).toBeInstanceOf(Comfy);
  });

  it("targets Comfy Cloud when constructed with no arguments", () => {
    expect(new Comfy()).toBeInstanceOf(Comfy);
  });

  it("still accepts an explicit base URL positionally", () => {
    // The form every existing caller uses; self-hosted targets need it.
    expect(new Comfy("http://127.0.0.1:8189", { apiKey: "comfyui-test" })).toBeInstanceOf(Comfy);
  });
});
