import { describe, expect, it } from "vitest";

import { abortableSleep } from "./abortable-sleep.js";

describe("abortableSleep", () => {
  it("resolves after the delay when the signal never aborts", async () => {
    const start = Date.now();
    await abortableSleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await expect(abortableSleep(10_000, controller.signal)).rejects.toBeTruthy();
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("rejects promptly when the signal aborts mid-wait, long before the delay elapses", async () => {
    const controller = new AbortController();
    const promise = abortableSleep(10_000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    const start = Date.now();
    await expect(promise).rejects.toBeTruthy();
    expect(Date.now() - start).toBeLessThan(500);
  });
});
