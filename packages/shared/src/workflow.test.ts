import { describe, expect, it } from "vitest";

import { assertWorkflowTransition, canTransition, WorkflowState } from "./workflow.js";

describe("workflow transitions", () => {
  it("preserves the explicit video confirmation gate", () => {
    expect(canTransition(WorkflowState.WaitingForVideoConfirmation, WorkflowState.GeneratingVideos)).toBe(true);
  });

  it("blocks skipping from images directly to video generation", () => {
    expect(() => assertWorkflowTransition(WorkflowState.ImagesReady, WorkflowState.GeneratingVideos)).toThrow("Invalid workflow transition");
  });
});
