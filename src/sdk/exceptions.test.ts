import { describe, expect, it } from "vitest";

import { ApiError } from "../low/index.js";
import {
  BlobNotFound,
  Forbidden,
  HashMismatch,
  IdempotencyKeyReuse,
  InsufficientCredits,
  InvalidWorkflow,
  MissingAsset,
  NotFound,
  QueueFull,
  Unauthorized,
  WorkflowFormatUi,
  toSdkError,
} from "./exceptions.js";

describe("toSdkError", () => {
  const cases: Array<[string, new (...args: never[]) => Error]> = [
    ["invalid_workflow", InvalidWorkflow],
    ["workflow_format_ui", WorkflowFormatUi],
    ["missing_asset", MissingAsset],
    ["hash_mismatch", HashMismatch],
    ["blob_not_found", BlobNotFound],
    ["idempotency_key_reuse", IdempotencyKeyReuse],
    ["insufficient_credits", InsufficientCredits],
    ["not_found", NotFound],
    ["unauthorized", Unauthorized],
    ["forbidden", Forbidden],
  ];

  it.each(cases)("maps protocol code %s to the idiomatic %s", (code, expectedClass) => {
    const apiError = new ApiError("boom", { code, httpStatus: 400 });
    expect(toSdkError(apiError)).toBeInstanceOf(expectedClass);
  });

  it("carries retryAfter onto QueueFull", () => {
    const apiError = new ApiError("full", { code: "queue_full", httpStatus: 429, retryAfter: 5 });
    const sdkError = toSdkError(apiError);
    expect(sdkError).toBeInstanceOf(QueueFull);
    expect((sdkError as QueueFull).retryAfter).toBe(5);
  });
});
