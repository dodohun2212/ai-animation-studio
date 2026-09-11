import { describe, expect, it } from "vitest";

import { ImageGenerationApiError, toImageGenerationDisplayError } from "./imageGenerationApi.js";

/**
 * The line that carries the image failure answer to the screen (docs/00_NOW.md ②-2).
 *
 * 🔴 This file exists because the composing function can be entirely right and the screen still say the old
 * sentence: `imageFailureMessage` has its own tests, and removing the call to it from this module left all 487
 * of them green. What is guarded here is the join — that the mapper actually asks for the composed answer.
 */
describe("toImageGenerationDisplayError", () => {
  const SAFETY = "OpenAI 안전 정책에 따라";

  it("says where the run stopped alongside what the provider said", () => {
    const error = new ImageGenerationApiError("IMAGE_PROVIDER_ERROR", "raw backend detail", {
      category: "safety_policy",
      sceneNumber: 3,
      scope: "run",
      billedOnFailure: true,
      remedy: "change_input",
    });

    const { code, message } = toImageGenerationDisplayError(error);

    expect(code).toBe("IMAGE_PROVIDER_ERROR");
    expect(message).toContain("3번 장면에서 멈췄습니다");
    expect(message).toContain(SAFETY);
    expect(message).toContain("예산에는 쓴 것으로 계상");
    // The backend's own words never reach the screen — the rule this module existed for before ②-2.
    expect(message).not.toContain("raw backend detail");
  });

  /*
   * 🔴 A response from a build that predates `ImageGenerationFailureDetails` must read exactly as it did before.
   * An older server is not a reason to start claiming a scene number or a budget charge.
   */
  it("falls back to the category sentence alone when the error carries no details", () => {
    const message = toImageGenerationDisplayError(
      new ImageGenerationApiError("IMAGE_PROVIDER_ERROR", "raw", { category: "safety_policy" }),
    ).message;

    expect(message).toContain(SAFETY);
    expect(message).not.toContain("장면에서 멈췄습니다");
    expect(message).not.toContain("예산");
  });

  it("still refuses the backend's text for a code it does not know", () => {
    const { message } = toImageGenerationDisplayError(new ImageGenerationApiError("SOMETHING_NEW", "raw backend detail"));
    expect(message).not.toContain("raw backend detail");
  });
});
