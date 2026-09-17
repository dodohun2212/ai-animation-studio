import { describe, expect, it } from "vitest";

import {
  assertNewsSummaryCheck,
  assertVideoGenerationApproval,
  type NewsClaimCheck,
  type NewsSummaryCheck,
  type StartVideoGenerationRequest,
} from "./api.js";

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

  it("rejects a gap in the scene sequence, too few/too many prompts, or missing request identity", () => {
    const gapped = approvedRequest();
    gapped.prompts.splice(2, 1);
    expect(() => assertVideoGenerationApproval(gapped)).toThrow();

    const tooFew = approvedRequest();
    tooFew.prompts = tooFew.prompts.slice(0, 1);
    expect(() => assertVideoGenerationApproval(tooFew)).toThrow();

    const tooMany = approvedRequest();
    tooMany.prompts = Array.from({ length: 13 }, (_, index) => ({ sceneNumber: index + 1, prompt: `Prompt ${index + 1}` }));
    expect(() => assertVideoGenerationApproval(tooMany)).toThrow();

    const unidentified = approvedRequest();
    unidentified.userRequestId = "";
    expect(() => assertVideoGenerationApproval(unidentified)).toThrow();
  });

  it("accepts a prompt count anywhere in the supported 2-12 range, not just six", () => {
    const request = approvedRequest();
    request.prompts = Array.from({ length: 4 }, (_, index) => ({ sceneNumber: index + 1, prompt: `Prompt ${index + 1}` }));
    expect(() => assertVideoGenerationApproval(request)).not.toThrow();
  });
});

function claim(text: string, found: boolean, kind: NewsClaimCheck["kind"] = "number"): NewsClaimCheck {
  return { kind, text, found };
}

/** `missing` derived from `claims`, which is the only way the two can be trusted to agree. */
function checkOf(claims: NewsClaimCheck[]): NewsSummaryCheck {
  return { claims, missing: claims.filter((one) => !one.found) };
}

describe("news summary check", () => {
  it("accepts a check whose missing list is exactly its unfound claims", () => {
    expect(() => assertNewsSummaryCheck(checkOf([
      claim("3조 2천억 원", true),
      claim("2026년 9월 14일", true, "date"),
      claim("「그럴 계획은 없다」", false, "quote"),
    ]))).not.toThrow();
  });

  /** Nothing to check is not the same as nothing missing, but it is a consistent answer and the server decides. */
  it("accepts a check that looked at nothing", () => {
    expect(() => assertNewsSummaryCheck(checkOf([]))).not.toThrow();
  });

  /**
   * 🔴 The one thing this type can lie about. A span that was not in the article, dropped from `missing`, hands
   * the screen a clean summary while `claims` still records the invention — and the refusal that is supposed to
   * stop it from leaving the building never fires.
   */
  it("refuses a missing list that hides an unfound claim", () => {
    const claims = [claim("4천 명", true), claim("2026년 3월", false, "date")];
    expect(() => assertNewsSummaryCheck({ claims, missing: [] })).toThrow();
  });

  /** The other direction costs a real article: blocked over something the writer never said was absent. */
  it("refuses a missing list that invents a failure", () => {
    const claims = [claim("4천 명", true)];
    expect(() => assertNewsSummaryCheck({ claims, missing: [claim("4천 명", false)] })).toThrow();
  });

  /** An empty span cannot have been looked for, so `found: true` on one would be a pass nobody earned. */
  it("refuses a claim with no text", () => {
    expect(() => assertNewsSummaryCheck(checkOf([claim("   ", true)]))).toThrow();
  });
});
