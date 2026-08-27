import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeAsset, makeAssetFolder, makeMapping, makeReview } from "../api/testUtils.js";
import { MappingReviewScreen } from "./MappingReviewScreen.js";
import { episodeMappingApi, projectMappingApi } from "../api/mappingsApi.js";

function mappingList(): HTMLElement {
  return screen.getByRole("list", { name: "Mapping 목록" });
}

describe("MappingReviewScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads mappings, review state, and joined asset details, then shows a fingerprint/revision panel", async () => {
    const mapping = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A", status: "confirmed" });
    const asset = makeAsset({ assetId: "ASSET-A", displayName: "대표 캐릭터", assetType: "character" });
    const review = makeReview({ mappingRevision: 2, scriptRevision: 1, scriptFingerprint: "f".repeat(64), reviewedScenes: [1, 2] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mapping] }))
      .mockResolvedValueOnce(jsonResponse(200, { review }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);

    expect(screen.getByText("Mapping을 불러오는 중...")).toBeTruthy();
    await screen.findByText("대표 캐릭터");

    const reviewStatus = screen.getByRole("region", { name: "검토 상태" });
    expect(within(reviewStatus).getByText("2")).toBeTruthy(); // mappingRevision
    expect(within(reviewStatus).getByText("1")).toBeTruthy(); // scriptRevision
    expect(within(reviewStatus).getByText("f".repeat(64))).toBeTruthy();
    expect(within(reviewStatus).getByText("1, 2")).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/projects/sample_project/assets/mappings");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/projects/sample_project/assets/mapping-review");
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/assets/ASSET-A");
  });

  it("shows a safe error alert when the initial mappings load fails, without crashing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: "ASSET_MAPPING_STORAGE_ERROR", message: "raw C:\\secret" }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }));
    vi.stubGlobal("fetch", fetchMock);

    const rendered = render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);

    const alert = await screen.findByTestId("mappings-error");
    expect(alert).toHaveAttribute("data-error-code", "ASSET_MAPPING_STORAGE_ERROR");
    expect(rendered.container.innerHTML).not.toContain("secret");
  });

  it("filters mappings by status, type, and scene", async () => {
    const mappingA = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A", status: "confirmed", sceneScope: { kind: "scene", sceneNumber: 1 } });
    const mappingB = makeMapping({ mappingId: "MAP-B", assetId: "ASSET-B", status: "excluded", sceneScope: { kind: "scene", sceneNumber: 3 } });
    const assetA = makeAsset({ assetId: "ASSET-A", displayName: "캐릭터 자산", assetType: "character" });
    const assetB = makeAsset({ assetId: "ASSET-B", displayName: "배경 자산", assetType: "background" });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mappingA, mappingB] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetA, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { asset: assetB, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true })));

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("캐릭터 자산");
    // `mappingB` is excluded, and excluded connections are out of the list by default — "제외" that leaves the
    // row looking exactly as present as the ones in use reads as if it had not taken effect.
    expect(within(mappingList()).getAllByRole("listitem")).toHaveLength(1);

    // Asking for 제외됨 by name is an explicit request to see them, so it overrides that default.
    fireEvent.change(screen.getByLabelText("상태"), { target: { value: "excluded" } });
    await waitFor(() => expect(within(mappingList()).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("배경 자산")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("상태"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("유형"), { target: { value: "character" } });
    await waitFor(() => expect(within(mappingList()).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("캐릭터 자산")).toBeTruthy();

    // Scene 3 matches only the excluded one, so the list is empty until 보기 is pressed — and the line above
    // the list is what says so, rather than leaving the filter looking broken.
    fireEvent.change(screen.getByLabelText("유형"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("장면"), { target: { value: "3" } });
    await waitFor(() => expect(within(mappingList()).queryAllByRole("listitem")).toHaveLength(0));

    fireEvent.click(screen.getByTestId("toggle-excluded"));
    await waitFor(() => expect(within(mappingList()).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("배경 자산")).toBeTruthy();
  });

  it("confirms and excludes a mapping via PATCH, updating the row and the review panel from the response", async () => {
    const mapping = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A", status: "suggested" });
    const asset = makeAsset({ assetId: "ASSET-A", displayName: "대상 자산" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mapping] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview({ mappingRevision: 0 }) }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, {
        mapping: { ...mapping, status: "confirmed", userConfirmed: true },
        review: makeReview({ mappingRevision: 1 }),
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("대상 자산");
    expect(screen.getByText("상태: 제안됨")).toBeTruthy();

    fireEvent.click(within(mappingList()).getByRole("button", { name: "확인" }));

    await screen.findByText("상태: 확인됨");
    const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/assets/mappings/MAP-A");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "confirm" });
  });

  it("prevents a duplicate PATCH while a decision request is already in flight", async () => {
    const mapping = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A", status: "suggested" });
    const asset = makeAsset({ assetId: "ASSET-A", displayName: "대상 자산" });
    let resolveDecision: (response: Response) => void = () => {};
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mapping] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDecision = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("대상 자산");

    const confirmButton = within(mappingList()).getByRole("button", { name: "확인" });
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(4); // 3 initial loads + exactly one PATCH

    resolveDecision(jsonResponse(200, { mapping: { ...mapping, status: "confirmed" }, review: makeReview() }));
    // The button does not come back re-enabled — once the mapping is confirmed there is nothing left for it to
    // do, so the row drops it. Waiting on the old node would wait forever. The in-flight guard is what this
    // test is about, and the single PATCH above is what proves it.
    await waitFor(() => expect(within(mappingList()).queryByRole("button", { name: "확인" })).toBeNull());
    expect(within(mappingList()).getByRole("button", { name: "제외" })).not.toBeDisabled();
  });

  it("creates a snapshot via POST and shows the resulting snapshot info", async () => {
    const mapping = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A", snapshot: null });
    const asset = makeAsset({ assetId: "ASSET-A", displayName: "대상 자산" });
    const snapshotted = { ...mapping, snapshot: { relativePath: "asset_snapshots/MAP-A-v1.png", sha256: "c".repeat(64), sourceVersion: 1 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mapping] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { mapping: snapshotted }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("대상 자산");
    expect(screen.getByText("스냅샷: 없음")).toBeTruthy();

    fireEvent.click(within(mappingList()).getByRole("button", { name: "스냅샷 생성" }));

    await waitFor(() => expect(screen.queryByText("스냅샷: 없음")).toBeNull());
    const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url).toBe("/projects/sample_project/assets/mappings/MAP-A/snapshot");
    expect(init.method).toBe("POST");
  });

  it("begins a review then approves it, showing the approved status and reviewed scenes", async () => {
    const initialReview = makeReview({ mappingRevision: 0, scriptRevision: 0, scriptFingerprint: "" });
    const begunReview = makeReview({ mappingRevision: 1, scriptRevision: 0, scriptFingerprint: "a".repeat(64) });
    const approvedReview = makeReview({
      mappingRevision: 1, scriptRevision: 0, scriptFingerprint: "a".repeat(64),
      status: "approved", approvedAt: "2026-08-22T00:00:00.000Z", approvedBy: "user", reviewedScenes: [1, 2, 3, 4, 5, 6],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: initialReview }))
      .mockResolvedValueOnce(jsonResponse(200, { review: begunReview }))
      .mockResolvedValueOnce(jsonResponse(200, { review: approvedReview }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "지금 대본 기준으로 다시 맞추기" }));
    await screen.findByText("a".repeat(64));
    const [beginUrl, beginInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(beginUrl).toBe("/projects/sample_project/assets/mapping-review");
    expect(JSON.parse(String(beginInit.body))).toEqual({ scriptRevision: 0, textOnlyConfirmed: false, legacyConfirmed: false });

    fireEvent.click(screen.getByRole("button", { name: "연결 다 했음 · 다음 단계로" }));
    await screen.findByText("승인됨");
    const [approveUrl, approveInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(approveUrl).toBe("/projects/sample_project/assets/mapping-review/approve");
    expect(JSON.parse(String(approveInit.body))).toEqual({ scriptFingerprint: "a".repeat(64) });
    expect(screen.getByText("1, 2, 3, 4, 5, 6")).toBeTruthy();
  });

  it("moves on to the image step once approval succeeds, instead of only refreshing a status line", async () => {
    const review = makeReview({ scriptFingerprint: "a".repeat(64) });
    const approved = makeReview({ scriptFingerprint: "a".repeat(64), status: "approved", approvedAt: "2026-08-22T00:00:00.000Z", approvedBy: "user", reviewedScenes: [1, 2] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { review }))
      .mockResolvedValueOnce(jsonResponse(200, { review: approved }));
    vi.stubGlobal("fetch", fetchMock);
    const onOpenImageGeneration = vi.fn();

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} onOpenImageGeneration={onOpenImageGeneration} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "연결 다 했음 · 다음 단계로" }));
    await waitFor(() => expect(onOpenImageGeneration).toHaveBeenCalled());
  });

  it("offers a plain way forward when the review is already approved, and says the check is optional", async () => {
    const approved = makeReview({ scriptFingerprint: "a".repeat(64), status: "approved", approvedAt: "2026-08-22T00:00:00.000Z", approvedBy: "user", reviewedScenes: [1, 2] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: approved }));
    vi.stubGlobal("fetch", fetchMock);
    const onOpenImageGeneration = vi.fn();

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} onOpenImageGeneration={onOpenImageGeneration} />);
    await screen.findByText("승인됨");

    // Re-running the check is still offered, but its label no longer claims work that is already done.
    expect(screen.getByTestId("approve-review-button").textContent).toBe("다시 검사하고 다음 단계로");
    fireEvent.click(screen.getByTestId("skip-to-image-generation"));
    expect(onOpenImageGeneration).toHaveBeenCalled();
    // Moving on this way sends nothing — only the two initial loads happened.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("separates 참고 이미지 from the Story-prompt-only settings, which is what made the name ambiguous", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview({}) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    const definition = await screen.findByTestId("reference-image-definition");
    expect(definition.textContent).toContain("등장 캐릭터");
    // The settings choices now DO seed this list (syncAutoMappings), so the old "자동으로 올라오지 않습니다"
    // wording became false the moment that shipped. What stays true is the two-channel split.
    expect(definition.textContent).toContain("자동으로 올라옵니다");
    expect(definition.textContent).toContain("그림에는 이미지로, 대본에는 글로");
  });

  it("keeps excluded connections out of the list until asked for, since there is no delete", async () => {
    const kept = makeAsset({ assetId: "ASSET-KEEP", displayName: "쓰는 그림" });
    const dropped = makeAsset({ assetId: "ASSET-DROP", displayName: "안 쓰는 그림" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split("?")[0]!;
      if (url === "/projects/sample_project/assets/mappings") return jsonResponse(200, { mappings: [
        makeMapping({ mappingId: "MAP-KEEP", assetId: kept.assetId, status: "confirmed" }),
        makeMapping({ mappingId: "MAP-DROP", assetId: dropped.assetId, status: "excluded" }),
      ] });
      if (url === "/projects/sample_project/assets/mapping-review") return jsonResponse(200, { review: makeReview({}) });
      if (url === `/assets/${kept.assetId}`) return jsonResponse(200, { asset: kept, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
      if (url === `/assets/${dropped.assetId}`) return jsonResponse(200, { asset: dropped, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("쓰는 그림");
    // Leaving it in the list made 제외 look like it had not worked.
    expect(screen.queryByText("안 쓰는 그림")).toBeNull();

    fireEvent.click(screen.getByTestId("toggle-excluded"));
    expect(await screen.findByText("안 쓰는 그림")).toBeTruthy();
  });

  it("connects an Asset Library image to the project — the step that had no entry point at all", async () => {
    // Until this existed nothing in the app called POST /assets/mappings, so every project generated its
    // scene images with zero reference pictures attached.
    const folder = makeAssetFolder({ assetId: "ASSET-CHAR-FOLDER", displayName: "이배드", assetType: "character", childAssetIds: ["ASSET-CHILD"] });
    const child = makeAsset({ assetId: "ASSET-CHILD", displayName: "이배드_정면", assetType: "character", parentFolderId: folder.assetId });
    const created = makeMapping({ mappingId: "MAP-NEW", assetId: folder.assetId });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).split("?")[0]!;
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (url === "/assets") return jsonResponse(200, { assets: [folder, child] });
      if (url === "/projects/sample_project/assets/mappings" && method === "POST") return jsonResponse(201, { mapping: created });
      if (url === "/projects/sample_project/assets/mappings") return jsonResponse(200, { mappings: [] });
      if (url === "/projects/sample_project/assets/mapping-review") return jsonResponse(200, { review: makeReview({}) });
      if (url === `/assets/${folder.assetId}`) return jsonResponse(200, { asset: folder, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");

    fireEvent.click(within(screen.getByRole("form", { name: "연결할 이미지 검색" })).getByRole("button", { name: "검색" }));
    const candidates = await screen.findByRole("list", { name: "연결할 이미지 후보" });
    // The folder is offered; the drawing inside it is not — a folder mapping already resolves to that child.
    expect(within(candidates).queryByText("이배드_정면")).toBeNull();
    expect(within(candidates).getByText("폴더 · 이미지 1장")).toBeTruthy();

    fireEvent.click(within(candidates).getByRole("button", { name: "연결" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url) === "/projects/sample_project/assets/mappings" && (init as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === "/projects/sample_project/assets/mappings" && (init as RequestInit | undefined)?.method === "POST")!;
    // No versionPolicy: the server decides it, since a Folder may only ever be follow_latest.
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      assetId: "ASSET-CHAR-FOLDER", usageRole: "character", sceneScope: { kind: "all" },
    });
  });

  it("keeps a project's own generated images out of the candidate list", async () => {
    // The Library files each project's finished scene images into an auto-made folder. Offering that back as
    // reference material means feeding a project's output in as its own input — the user saw a folder called
    // "1 generated images" sitting next to their character.
    const character = makeAssetFolder({ assetId: "ASSET-CHAR", displayName: "이배드", assetType: "character", childAssetIds: ["C1"] });
    const generated = makeAssetFolder({ assetId: "ASSET-GEN", displayName: "1 generated images", assetType: "general_reference", sourceProjectId: "1", childAssetIds: ["G1"] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split("?")[0]!;
      if (url === "/assets") return jsonResponse(200, { assets: [character, generated] });
      if (url === "/projects/sample_project/assets/mappings") return jsonResponse(200, { mappings: [] });
      if (url === "/projects/sample_project/assets/mapping-review") return jsonResponse(200, { review: makeReview({}) });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");
    fireEvent.click(within(screen.getByRole("form", { name: "연결할 이미지 검색" })).getByRole("button", { name: "검색" }));

    const candidates = await screen.findByRole("list", { name: "연결할 이미지 후보" });
    expect(within(candidates).getByText("이배드")).toBeTruthy();
    expect(within(candidates).queryByText("1 generated images")).toBeNull();
  });

  it("says 제외됨, not 연결됨, for an asset whose connection the user turned off", async () => {
    const asset = makeAsset({ assetId: "ASSET-OFF", displayName: "안 쓰기로 한 그림", assetType: "background" });
    const excluded = makeMapping({ mappingId: "MAP-OFF", assetId: asset.assetId, status: "excluded" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split("?")[0]!;
      if (url === "/assets") return jsonResponse(200, { assets: [asset] });
      if (url === "/projects/sample_project/assets/mappings") return jsonResponse(200, { mappings: [excluded] });
      if (url === "/projects/sample_project/assets/mapping-review") return jsonResponse(200, { review: makeReview({}) });
      if (url === `/assets/${asset.assetId}`) return jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    // The excluded row itself is hidden by default now, so wait on the line that reports it instead.
    await screen.findByTestId("toggle-excluded");
    fireEvent.click(within(screen.getByRole("form", { name: "연결할 이미지 검색" })).getByRole("button", { name: "검색" }));

    const candidates = await screen.findByRole("list", { name: "연결할 이미지 후보" });
    // Calling an excluded connection "연결됨" told the user the opposite of what they had just chosen.
    expect(within(candidates).getByRole("button", { name: "제외됨" })).toBeTruthy();
    expect(within(candidates).queryByRole("button", { name: "연결됨" })).toBeNull();
  });

  it("scopes a connection to one scene when asked to", async () => {
    const asset = makeAsset({ assetId: "ASSET-BG", displayName: "지하 기록관", assetType: "background" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).split("?")[0]!;
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (url === "/assets") return jsonResponse(200, { assets: [asset] });
      if (url === "/projects/sample_project/assets/mappings" && method === "POST") return jsonResponse(201, { mapping: makeMapping({ mappingId: "MAP-BG", assetId: asset.assetId }) });
      if (url === "/projects/sample_project/assets/mappings") return jsonResponse(200, { mappings: [] });
      if (url === "/projects/sample_project/assets/mapping-review") return jsonResponse(200, { review: makeReview({}) });
      if (url === `/assets/${asset.assetId}`) return jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: false });
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");

    fireEvent.change(screen.getByLabelText("어떤 용도로 쓰나요"), { target: { value: "background" } });
    fireEvent.change(screen.getByLabelText("어느 장면에"), { target: { value: "scene" } });
    fireEvent.change(await screen.findByLabelText("연결할 장면 번호"), { target: { value: "3" } });
    fireEvent.click(within(screen.getByRole("form", { name: "연결할 이미지 검색" })).getByRole("button", { name: "검색" }));
    fireEvent.click(within(await screen.findByRole("list", { name: "연결할 이미지 후보" })).getByRole("button", { name: "연결" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url) === "/projects/sample_project/assets/mappings" && (init as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === "/projects/sample_project/assets/mappings" && (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      assetId: "ASSET-BG", usageRole: "background", sceneScope: { kind: "scene", sceneNumber: 3 },
    });
  });

  it("shows a safe mapped error with missing scene numbers when approval is blocked", async () => {
    const review = makeReview({ scriptFingerprint: "a".repeat(64) });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { review }))
      .mockResolvedValueOnce(jsonResponse(409, {
        code: "ASSET_MAPPING_APPROVAL_BLOCKED",
        message: "internal detail never shown",
        details: { missingSceneNumbers: [2, 4] },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const rendered = render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "연결 다 했음 · 다음 단계로" }));

    const alert = await screen.findByTestId("review-mutation-error");
    expect(alert).toHaveAttribute("data-error-code", "ASSET_MAPPING_APPROVAL_BLOCKED");
    expect(alert.textContent).toContain("2, 4");
    expect(rendered.container.innerHTML).not.toContain("internal detail never shown");
  });

  it("shows a safe mapped error when the script fingerprint no longer matches", async () => {
    const review = makeReview({ scriptFingerprint: "a".repeat(64) });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { review }))
      .mockResolvedValueOnce(jsonResponse(409, { code: "ASSET_MAPPING_FINGERPRINT_MISMATCH", message: "internal detail" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "연결 다 했음 · 다음 단계로" }));

    const alert = await screen.findByTestId("review-mutation-error");
    expect(alert).toHaveAttribute("data-error-code", "ASSET_MAPPING_FINGERPRINT_MISMATCH");
  });

  it("keeps the previously loaded mappings and review visible when a refresh fails, showing the error alongside", async () => {
    const mapping = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A" });
    const asset = makeAsset({ assetId: "ASSET-A", displayName: "유지되어야 할 자산" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mapping] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "ASSET_MAPPING_JSON_MALFORMED", message: "raw detail" }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("유지되어야 할 자산");

    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));

    const alert = await screen.findByTestId("mappings-error");
    expect(alert).toHaveAttribute("data-error-code", "ASSET_MAPPING_JSON_MALFORMED");
    expect(screen.getByText("유지되어야 할 자산")).toBeTruthy();
  });

  it("calls onBack when the back button is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() })));
    const onBack = vi.fn();
    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={onBack} />);
    await screen.findByText("등록된 참고 이미지 연결이 없습니다.");

    fireEvent.click(screen.getByRole("button", { name: "프로젝트로 돌아가기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("drops the per-row 확인 button once a mapping is already confirmed, since confirming it again changes nothing", async () => {
    const mapping = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A", status: "confirmed" });
    const asset = makeAsset({ assetId: "ASSET-A", displayName: "직접 연결한 자산" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mapping] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("직접 연결한 자산");

    // A mapping you made yourself is saved as confirmed — the button would be a no-op.
    expect(within(mappingList()).queryByRole("button", { name: "확인" })).toBeNull();
    // 제외 stays: changing your mind about a connection is a real action.
    expect(within(mappingList()).getByRole("button", { name: "제외" })).toBeTruthy();
  });

  it("never issues a request to a provider, video, or FFmpeg-related route across the full mapping-review flow", async () => {
    const mapping = makeMapping({ mappingId: "MAP-A", assetId: "ASSET-A", status: "suggested" });
    const asset = makeAsset({ assetId: "ASSET-A", displayName: "대상 자산" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { mappings: [mapping] }))
      .mockResolvedValueOnce(jsonResponse(200, { review: makeReview() }))
      .mockResolvedValueOnce(jsonResponse(200, { asset, usageProjectIds: [], ownership: "library_manual", canDeleteOwnedFile: true }))
      .mockResolvedValueOnce(jsonResponse(200, { mapping: { ...mapping, status: "confirmed" }, review: makeReview() }))
      .mockResolvedValueOnce(jsonResponse(200, { mapping: { ...mapping, status: "confirmed", snapshot: { relativePath: "asset_snapshots/MAP-A-v1.png", sha256: "d".repeat(64), sourceVersion: 1 } } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={projectMappingApi("sample_project")} onBack={() => {}} />);
    await screen.findByText("대상 자산");
    fireEvent.click(within(mappingList()).getByRole("button", { name: "확인" }));
    await screen.findByText("상태: 확인됨");
    fireEvent.click(within(mappingList()).getByRole("button", { name: "스냅샷 생성" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    for (const [url] of fetchMock.mock.calls as Array<[string]>) {
      expect(url).toMatch(/^\/(projects\/sample_project\/assets|assets)/);
      expect(url).not.toContain("/videos/");
      expect(url).not.toContain("/settings/providers");
    }
  });

  it("sends its calls to the Episode when given the Episode adapter, with no other change", async () => {
    // The point of the adapter, asserted: one screen, two owners, and the ONLY difference is the URL. Before
    // this, a Long Episode had its own screen and its own service, which could not create a mapping at all and
    // refused the character Folders its own UI offered. If this ever fails because
    // someone gave the screen an id again, that divergence is starting over.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { mappings: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MappingReviewScreen api={episodeMappingApi("sample_project", 3)} onBack={() => {}} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const called = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(called).toContain("/long-projects/sample_project/episodes/3/assets/mappings");
    expect(called).toContain("/long-projects/sample_project/episodes/3/assets/mapping-review");
    expect(called.every((url) => !url.startsWith("/projects/"))).toBe(true);
  });
});
