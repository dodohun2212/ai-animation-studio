import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongEpisodeMappingReviewScreen } from "./LongEpisodeMappingReviewScreen.js";

const episode = (status: "script_approved" | "waiting_for_asset_mapping_review" | "asset_mapping_approved" = "script_approved") => ({
  episodeNumber: 1, title: "Episode 1", summary: "Summary", mainEvent: "Event", conflict: "Conflict", cliffhanger: "Hook", nextEpisodeHook: "Next",
  status, approved: true, scriptRevision: 3, scriptHistoryCount: 2,
});
const candidate = { mappingId: "MAP-1", sourceCollection: "characters" as const, sourceItemId: "hero", assetId: "ASSET-1", usageRole: "character" as const, versionPolicy: "pinned_version" as const, pinnedVersion: 2, episodeScope: { mode: "episode" as const, episode: 1 }, status: "suggested" as const, userConfirmed: false };
const review = (overrides: Record<string, unknown> = {}) => ({ projectId: "long", episodeNumber: 1, mappingRevision: 0, scriptRevision: 3, scriptFingerprint: "a".repeat(64), status: "waiting" as const, textOnlyConfirmed: false, candidates: [candidate], ...overrides });
const automaticSummary = { candidateAssetIds: ["ASSET-1"], selectedAssetIdsByScene: { 1: ["ASSET-1"], 2: [], 3: ["ASSET-1"], 4: [], 5: [], 6: [] }, estimatedImageApiCalls: 6 as const };

describe("LongEpisodeMappingReviewScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reviews scoped candidates and submits no final approval until its separate confirmation", async () => {
    const started = review({ mappingRevision: 1 });
    const confirmed = { ...candidate, status: "confirmed" as const, userConfirmed: true };
    const approved = { ...started, status: "approved" as const, candidates: [confirmed] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode() }))
      .mockResolvedValueOnce(jsonResponse(200, { review: review() }))
      .mockResolvedValueOnce(jsonResponse(200, { review: started }))
      .mockResolvedValueOnce(jsonResponse(200, { summary: automaticSummary }))
      .mockResolvedValueOnce(jsonResponse(200, { mapping: confirmed, review: { ...started, candidates: [confirmed] } }))
      .mockResolvedValueOnce(jsonResponse(200, { review: approved, episode: episode("asset_mapping_approved") }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LongEpisodeMappingReviewScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByText("캐릭터: hero")).toBeTruthy();
    expect(screen.getByText(/대본 리비전: 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "검토 시작" }));
    expect(await screen.findByTestId("episode-automatic-reference-preview")).toBeTruthy();
    expect(screen.getByTestId("episode-automatic-reference-scene-1").textContent).toContain("ASSET-1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByRole("button", { name: "확정" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    fireEvent.click(screen.getByRole("button", { name: "최종 승인" }));
    expect(await screen.findByTestId("episode-mapping-approval-confirm")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole("button", { name: "매핑 승인" }));
    await waitFor(() => expect(screen.getByText(/Asset Mapping이 승인되었습니다/)).toBeTruthy());
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/long-projects/long/episodes/1/asset-mapping-review");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/long-projects/long/episodes/1/asset-mapping-review/automatic-selection");
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({ decision: "confirm" });
    expect(JSON.parse(String((fetchMock.mock.calls[5]?.[1] as RequestInit).body))).toEqual({ approved: true, scriptFingerprint: "a".repeat(64) });
  });

  it("requires explicit text-only confirmation only after an empty review has started", async () => {
    const empty = review({ candidates: [] });
    const started = { ...empty, mappingRevision: 1 };
    const textOnlyConfirmed = { ...started, textOnlyConfirmed: true };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode() }))
      .mockResolvedValueOnce(jsonResponse(200, { review: empty }))
      .mockResolvedValueOnce(jsonResponse(200, { review: started }))
      .mockResolvedValueOnce(jsonResponse(200, { summary: { ...automaticSummary, candidateAssetIds: [], selectedAssetIdsByScene: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } } }))
      .mockResolvedValueOnce(jsonResponse(200, { review: textOnlyConfirmed }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeMappingReviewScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByTestId("episode-mapping-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "검토 시작" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({});
    expect(screen.getByRole("button", { name: "최종 승인" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "텍스트만 진행 확인" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({ textOnlyConfirmed: true });
  });

  it("requires a separate confirmation before rerunning local automatic matching", async () => {
    const started = review({ mappingRevision: 2 });
    const rerunReview = review({ mappingRevision: 3, candidates: [candidate] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: episode("waiting_for_asset_mapping_review") }))
      .mockResolvedValueOnce(jsonResponse(200, { review: started }))
      .mockResolvedValueOnce(jsonResponse(200, { review: rerunReview, episode: episode("waiting_for_asset_mapping_review") }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeMappingReviewScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    expect(await screen.findByRole("button", { name: "자동 매칭 다시 실행" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "자동 매칭 다시 실행" }));
    expect(await screen.findByTestId("episode-asset-matching-rerun-confirm")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "다시 실행" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/long-projects/long/episodes/1/asset-mapping-review/rerun");
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("POST");
  });

  it("keeps the review unavailable before script approval and displays safe API errors", async () => {
    const notApproved = { ...episode(), status: "script_review" as const, approved: false };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: notApproved }))
      .mockResolvedValueOnce(jsonResponse(404, { code: "LONG_EPISODE_NOT_FOUND", message: "raw private backend detail" })));
    render(<LongEpisodeMappingReviewScreen projectId="long" episodeNumber={1} onBack={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw private backend detail");
  });

  it("does not tell an Episode that already finished mapping to go approve its script", async () => {
    // Not-eligible has two opposite causes; one message for both was telling finished Episodes to redo a step.
    const past = { ...episode(), status: "videos_approved" as const };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { episode: past }))
      .mockResolvedValue(jsonResponse(200, { review: review({ mappingRevision: 1, status: "approved" }) })));
    render(<LongEpisodeMappingReviewScreen projectId="long" episodeNumber={1} onBack={() => {}} />);

    expect((await screen.findByTestId("episode-mapping-already-done")).textContent).toContain("이미 마치고");
    expect(screen.queryByTestId("episode-mapping-not-eligible")).toBeNull();
  });
});
