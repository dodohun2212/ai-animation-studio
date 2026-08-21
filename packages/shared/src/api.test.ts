import { describe, expect, it } from "vitest";

import { assertVideoGenerationApproval, type StartVideoGenerationRequest } from "./api.js";

function approvedRequest(): StartVideoGenerationRequest {
  return {
    approved: true,
    confirmationId: "confirmation-1",
    userRequestId: "request-1",
    prompts: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
      sceneNumber: sceneNumber as 1 | 2 | 3 | 4 | 5 | 6,
      prompt: `Prompt ${sceneNumber}`,
    })),
  };
}

describe("video generation approval", () => {
  it("accepts one explicitly approved prompt per scene", () => {
    expect(() => assertVideoGenerationApproval(approvedRequest())).not.toThrow();
  });

  it("rejects incomplete prompts or missing request identity", () => {
    const incomplete = approvedRequest();
    incomplete.prompts.pop();
    expect(() => assertVideoGenerationApproval(incomplete)).toThrow();
    const unidentified = approvedRequest();
    unidentified.userRequestId = "";
    expect(() => assertVideoGenerationApproval(unidentified)).toThrow();
  });
});
