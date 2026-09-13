import { describe, expect, it } from "vitest";

import { VideosController } from "./videos.controller.js";

/*
 * The review routes hand every response through the merge side's measurement (VideoReview.clip) — both the GET
 * and the approve, since a screen replaces its list with whichever came back last.
 */
describe("VideosController review routes", () => {
  const response = { project: { id: "p" }, reviews: [{ sceneNumber: 1, status: "approved", updatedAt: "t" }] };
  const measuredBy = { withClipFacts: async (review: typeof response) => ({ ...review, measured: true }) };
  const workflow = { getReview: async () => response, approveReview: async () => response };
  const controller = new VideosController(undefined as never, undefined as never, workflow as never, measuredBy as never, undefined as never);

  it("measures the clips on the review it returns", async () => {
    expect(await controller.review("p", "job")).toMatchObject({ measured: true });
  });

  it("measures the clips on an approval's review too", async () => {
    expect(await controller.approveReview("p", "job", "1", { approved: true })).toMatchObject({ measured: true });
  });
});
