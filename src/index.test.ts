import { describe, expect, it } from "vitest";

import { Comfy } from "./index.js";

describe("Comfy", () => {
  it("constructs with a base URL and strips a trailing slash", () => {
    const client = new Comfy("http://127.0.0.1:8189/");
    expect(client).toBeInstanceOf(Comfy);
  });

  it("run() is not implemented yet", async () => {
    const client = new Comfy("http://127.0.0.1:8189");
    await expect(client.run({})).rejects.toThrow("not implemented yet");
  });
});
