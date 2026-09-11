import { VIDEO_MODELS } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import { videoModelCapability } from "./video-model-capability.js";

describe("what each video model can be handed", () => {
  it("declares a capability for every registered model, so none can be assumed", () => {
    for (const model of VIDEO_MODELS) expect(videoModelCapability(model), model).toBeDefined();
  });

  /**
   * Not a preference — the one thing this file must never get wrong in the permissive direction. Runway's own
   * docs do not confirm a last-frame input for gen4_turbo; a `true` here would build paid requests for a feature
   * nobody has seen work.
   */
  it("does not claim gen4_turbo takes a last frame, because nothing has confirmed it does", () => {
    expect(videoModelCapability("gen4_turbo").acceptsLastFrame).toBe(false);
  });
});
