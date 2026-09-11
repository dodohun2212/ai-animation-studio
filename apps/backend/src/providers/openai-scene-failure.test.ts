import { describe, expect, it } from "vitest";
import { SCENE_FAILURE_REMEDIES } from "@ai-animation-studio/shared";
import { openAiSceneFailureDetails } from "./openai-scene-failure.js";

describe("openAiSceneFailureDetails", () => {
  it("gives every category the frontend can phrase a remedy for one of the shared remedies", () => {
    expect(openAiSceneFailureDetails("rate_limit", 2, "run")).toEqual({ category: "rate_limit", sceneNumber: 2, scope: "run", billedOnFailure: true, remedy: "retry" });
    expect(openAiSceneFailureDetails("server", 1, "run").remedy).toBe("retry");
    expect(openAiSceneFailureDetails("network", 1, "run").remedy).toBe("retry");
    expect(openAiSceneFailureDetails("unknown", 1, "run").remedy).toBe("retry");
    expect(openAiSceneFailureDetails("invalid_request", 6, "run")).toEqual({ category: "invalid_request", sceneNumber: 6, scope: "run", billedOnFailure: true, remedy: "change_input" });
    expect(openAiSceneFailureDetails("safety_policy", 1, "run").remedy).toBe("change_input");
    expect(openAiSceneFailureDetails("context_length_exceeded", 1, "run").remedy).toBe("change_input");
    for (const category of ["rate_limit", "server", "network", "unknown", "invalid_request", "safety_policy", "context_length_exceeded"]) {
      expect(SCENE_FAILURE_REMEDIES).toContain(openAiSceneFailureDetails(category, 1, "run").remedy);
    }
  });

  it("leaves the remedy out where signing in or the account is the fix, which no remedy sentence says", () => {
    expect(openAiSceneFailureDetails("authentication", 3, "run")).toEqual({ category: "authentication", sceneNumber: 3, scope: "run", billedOnFailure: true });
    expect(openAiSceneFailureDetails("quota_or_permission", 3, "run")).toEqual({ category: "quota_or_permission", sceneNumber: 3, scope: "run", billedOnFailure: true });
  });

  it("says every refused picture counted against the month's budget, since each paid call is recorded whatever happened", () => {
    expect(openAiSceneFailureDetails("safety_policy", 4, "run").billedOnFailure).toBe(true);
    expect(openAiSceneFailureDetails("authentication", 4, "run").billedOnFailure).toBe(true);
  });

  it("carries whether a run stopped or one scene's redraw failed, since only a run continues on the next press", () => {
    expect(openAiSceneFailureDetails("server", 4, "run").scope).toBe("run");
    expect(openAiSceneFailureDetails("server", 4, "scene").scope).toBe("scene");
  });
});
