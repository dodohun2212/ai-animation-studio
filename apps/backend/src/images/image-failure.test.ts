import { describe, expect, it } from "vitest";
import { SCENE_FAILURE_REMEDIES } from "@ai-animation-studio/shared";
import { imageFailureDetails } from "./image-failure.js";

describe("imageFailureDetails", () => {
  it("gives every category the frontend can phrase a remedy for one of the shared remedies", () => {
    expect(imageFailureDetails("rate_limit", 2)).toEqual({ category: "rate_limit", sceneNumber: 2, billedOnFailure: true, remedy: "retry" });
    expect(imageFailureDetails("server", 1).remedy).toBe("retry");
    expect(imageFailureDetails("network", 1).remedy).toBe("retry");
    expect(imageFailureDetails("unknown", 1).remedy).toBe("retry");
    expect(imageFailureDetails("invalid_request", 6)).toEqual({ category: "invalid_request", sceneNumber: 6, billedOnFailure: true, remedy: "change_input" });
    expect(imageFailureDetails("safety_policy", 1).remedy).toBe("change_input");
    expect(imageFailureDetails("context_length_exceeded", 1).remedy).toBe("change_input");
    for (const category of ["rate_limit", "server", "network", "unknown", "invalid_request", "safety_policy", "context_length_exceeded"]) {
      expect(SCENE_FAILURE_REMEDIES).toContain(imageFailureDetails(category, 1).remedy);
    }
  });

  it("leaves the remedy out where signing in or the account is the fix, which no remedy sentence says", () => {
    expect(imageFailureDetails("authentication", 3)).toEqual({ category: "authentication", sceneNumber: 3, billedOnFailure: true });
    expect(imageFailureDetails("quota_or_permission", 3)).toEqual({ category: "quota_or_permission", sceneNumber: 3, billedOnFailure: true });
  });

  it("says every refused picture counted against the month's budget, since each paid call is recorded whatever happened", () => {
    expect(imageFailureDetails("safety_policy", 4).billedOnFailure).toBe(true);
    expect(imageFailureDetails("authentication", 4).billedOnFailure).toBe(true);
  });
});
