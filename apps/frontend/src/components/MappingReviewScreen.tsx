import { useEffect, useRef, useState } from "react";
import type {
  Asset,
  AssetMappingSceneScope,
  AssetMappingStatus,
  AssetType,
  ProjectAssetMapping,
  ProjectAssetMappingReview,
  SceneNumber,
  UpdateProjectAssetMappingDecision,
} from "@ai-animation-studio/shared";
import { getAsset, toAssetDisplayError } from "../api/assetsApi.js";
import {
  approveProjectAssetMappingReview,
  beginProjectAssetMappingReview,
  getProjectAssetMappingReview,
  listProjectAssetMappings,
  snapshotProjectAssetMapping,
  toMappingDisplayError,
  updateProjectAssetMapping,
} from "../api/mappingsApi.js";

interface Props { projectId: string; onBack: () => void }

type DisplayError = { code: string; message: string; details?: Record<string, unknown> };

const STATUS_LABELS: Record<AssetMappingStatus, string> = {
  confirmed: "확인됨", suggested: "제안됨", ambiguous: "모호함",
  unmatched: "매칭 안됨", excluded: "제외됨", invalid: "유효하지 않음",
};
const TYPE_LABELS: Record<AssetType, string> = {
  character: "캐릭터", style: "스타일", background: "배경", object: "오브젝트", general_reference: "일반 참고",
};
const SCENE_NUMBERS: readonly SceneNumber[] = [1, 2, 3, 4, 5, 6];

function scopeIncludesScene(scope: AssetMappingSceneScope, sceneNumber: SceneNumber): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "scene") return scope.sceneNumber === sceneNumber;
  if (scope.kind === "range") return scope.startScene <= sceneNumber && sceneNumber <= scope.endScene;
  return scope.sceneNumbers.includes(sceneNumber);
}

function scopeLabel(scope: AssetMappingSceneScope): string {
  if (scope.kind === "all") return "전체 장면";
  if (scope.kind === "scene") return `씬 ${scope.sceneNumber}`;
  if (scope.kind === "range") return `씬 ${scope.startScene}~${scope.endScene}`;
  return `씬 ${scope.sceneNumbers.join(", ")}`;
}

function errorDetailLabel(details: Record<string, unknown> | undefined): string | null {
  if (!details) return null;
  if (Array.isArray(details.missingSceneNumbers) && details.missingSceneNumbers.length > 0) {
    return `누락된 장면: ${details.missingSceneNumbers.join(", ")}`;
  }
  if (Array.isArray(details.mappingIds) && details.mappingIds.length > 0) {
    return `확인이 필요한 Mapping: ${details.mappingIds.join(", ")}`;
  }
  return null;
}

export function MappingReviewScreen({ projectId, onBack }: Props) {
  const [mappings, setMappings] = useState<ProjectAssetMapping[] | null>(null);
  const [mappingsError, setMappingsError] = useState<DisplayError | null>(null);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [review, setReview] = useState<ProjectAssetMappingReview | null>(null);
  const [reviewError, setReviewError] = useState<DisplayError | null>(null);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [assetErrors, setAssetErrors] = useState<Record<string, DisplayError>>({});

  const [statusFilter, setStatusFilter] = useState<AssetMappingStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<AssetType | "">("");
  const [sceneFilter, setSceneFilter] = useState<SceneNumber | "">("");

  const [textOnlyConfirmed, setTextOnlyConfirmed] = useState(false);
  const [legacyConfirmed, setLegacyConfirmed] = useState(false);
  const [beginPending, setBeginPending] = useState(false);
  const [approvePending, setApprovePending] = useState(false);
  const [reviewMutationError, setReviewMutationError] = useState<DisplayError | null>(null);

  const [decisionPendingIds, setDecisionPendingIds] = useState<Set<string>>(new Set());
  const [snapshotPendingIds, setSnapshotPendingIds] = useState<Set<string>>(new Set());
  const [decisionErrors, setDecisionErrors] = useState<Record<string, DisplayError>>({});
  const [snapshotErrors, setSnapshotErrors] = useState<Record<string, DisplayError>>({});

  const loadRequest = useRef(0);
  const decisionBusy = useRef<Set<string>>(new Set());
  const snapshotBusy = useRef<Set<string>>(new Set());
  const beginBusy = useRef(false);
  const approveBusy = useRef(false);

  async function loadAssetDetails(list: ProjectAssetMapping[], requestId: number) {
    const uniqueIds = [...new Set(list.map((item) => item.assetId))];
    const results = await Promise.allSettled(uniqueIds.map((assetId) => getAsset(assetId)));
    if (requestId !== loadRequest.current) return;
    const nextAssets: Record<string, Asset> = {};
    const nextErrors: Record<string, DisplayError> = {};
    uniqueIds.forEach((assetId, index) => {
      const outcome = results[index]!;
      if (outcome.status === "fulfilled") nextAssets[assetId] = outcome.value.asset;
      else nextErrors[assetId] = toAssetDisplayError(outcome.reason);
    });
    setAssets(nextAssets);
    setAssetErrors(nextErrors);
  }

  async function load() {
    const requestId = ++loadRequest.current;
    setMappingsLoading(true);
    setReviewLoading(true);
    const [mappingsResult, reviewResult] = await Promise.allSettled([
      listProjectAssetMappings(projectId),
      getProjectAssetMappingReview(projectId),
    ]);
    if (requestId !== loadRequest.current) return;
    if (mappingsResult.status === "fulfilled") {
      setMappings(mappingsResult.value.mappings);
      setMappingsError(null);
      void loadAssetDetails(mappingsResult.value.mappings, requestId);
    } else {
      setMappingsError(toMappingDisplayError(mappingsResult.reason));
    }
    if (reviewResult.status === "fulfilled") {
      setReview(reviewResult.value.review);
      setReviewError(null);
    } else {
      setReviewError(toMappingDisplayError(reviewResult.reason));
    }
    setMappingsLoading(false);
    setReviewLoading(false);
  }

  useEffect(() => { void load(); }, [projectId]);

  async function decide(mappingId: string, decision: UpdateProjectAssetMappingDecision) {
    if (decisionBusy.current.has(mappingId)) return;
    decisionBusy.current.add(mappingId);
    setDecisionPendingIds(new Set(decisionBusy.current));
    try {
      const response = await updateProjectAssetMapping(projectId, mappingId, { decision });
      setMappings((current) => (current ? current.map((item) => (item.mappingId === mappingId ? response.mapping : item)) : current));
      setReview(response.review);
      setDecisionErrors((current) => {
        if (!(mappingId in current)) return current;
        const next = { ...current };
        delete next[mappingId];
        return next;
      });
    } catch (caught) {
      setDecisionErrors((current) => ({ ...current, [mappingId]: toMappingDisplayError(caught) }));
    } finally {
      decisionBusy.current.delete(mappingId);
      setDecisionPendingIds(new Set(decisionBusy.current));
    }
  }

  async function createSnapshot(mappingId: string) {
    if (snapshotBusy.current.has(mappingId)) return;
    snapshotBusy.current.add(mappingId);
    setSnapshotPendingIds(new Set(snapshotBusy.current));
    try {
      const response = await snapshotProjectAssetMapping(projectId, mappingId);
      setMappings((current) => (current ? current.map((item) => (item.mappingId === mappingId ? response.mapping : item)) : current));
      setSnapshotErrors((current) => {
        if (!(mappingId in current)) return current;
        const next = { ...current };
        delete next[mappingId];
        return next;
      });
    } catch (caught) {
      setSnapshotErrors((current) => ({ ...current, [mappingId]: toMappingDisplayError(caught) }));
    } finally {
      snapshotBusy.current.delete(mappingId);
      setSnapshotPendingIds(new Set(snapshotBusy.current));
    }
  }

  async function beginReview() {
    if (beginBusy.current) return;
    beginBusy.current = true;
    setBeginPending(true);
    setReviewMutationError(null);
    try {
      const response = await beginProjectAssetMappingReview(projectId, {
        scriptRevision: review?.scriptRevision ?? 0,
        textOnlyConfirmed,
        legacyConfirmed,
      });
      setReview(response.review);
    } catch (caught) {
      setReviewMutationError(toMappingDisplayError(caught));
    } finally {
      beginBusy.current = false;
      setBeginPending(false);
    }
  }

  async function approve() {
    if (approveBusy.current || !review) return;
    approveBusy.current = true;
    setApprovePending(true);
    setReviewMutationError(null);
    try {
      const response = await approveProjectAssetMappingReview(projectId, { scriptFingerprint: review.scriptFingerprint });
      setReview(response.review);
    } catch (caught) {
      setReviewMutationError(toMappingDisplayError(caught));
    } finally {
      approveBusy.current = false;
      setApprovePending(false);
    }
  }

  const filteredMappings = (mappings ?? []).filter((mapping) => {
    if (statusFilter && mapping.status !== statusFilter) return false;
    if (typeFilter && assets[mapping.assetId]?.assetType !== typeFilter) return false;
    if (sceneFilter && !scopeIncludesScene(mapping.sceneScope, sceneFilter)) return false;
    return true;
  });

  return (
    <section className="mt-8 space-y-6">
      <header className="flex items-center justify-between">
        <button type="button" onClick={onBack}>프로젝트로 돌아가기</button>
        <h2 className="text-2xl font-semibold">Asset Mapping 검토</h2>
        <button type="button" onClick={() => void load()}>새로고침</button>
      </header>

      <section aria-label="검토 상태" className="space-y-2 rounded border border-white/10 p-4">
        {reviewLoading && !review && <p>검토 상태를 불러오는 중...</p>}
        {reviewError && (
          <p role="alert" data-testid="review-error" data-error-code={reviewError.code} className="text-red-300">{reviewError.message}</p>
        )}
        {review && (
          <dl className="space-y-1">
            <div><dt className="inline font-semibold">Mapping Revision: </dt><dd className="inline">{review.mappingRevision}</dd></div>
            <div><dt className="inline font-semibold">Script Revision: </dt><dd className="inline">{review.scriptRevision}</dd></div>
            <div><dt className="inline font-semibold">Fingerprint: </dt><dd className="inline break-all">{review.scriptFingerprint || "없음"}</dd></div>
            <div><dt className="inline font-semibold">상태: </dt><dd className="inline">{review.status === "approved" ? "승인됨" : "대기 중"}</dd></div>
            {review.status === "approved" && (
              <div><dt className="inline font-semibold">승인 시각: </dt><dd className="inline">{review.approvedAt}</dd></div>
            )}
            <div><dt className="inline font-semibold">검토된 장면: </dt><dd className="inline">{review.reviewedScenes.join(", ") || "없음"}</dd></div>
          </dl>
        )}
        <label className="block"><input type="checkbox" checked={textOnlyConfirmed} disabled={beginPending} onChange={(event) => setTextOnlyConfirmed(event.target.checked)} /> 텍스트만 사용(매핑 없음) 확인</label>
        <label className="block"><input type="checkbox" checked={legacyConfirmed} disabled={beginPending} onChange={(event) => setLegacyConfirmed(event.target.checked)} /> 기존 방식(legacy) 확인</label>
        <div className="flex gap-3">
          <button type="button" onClick={() => void beginReview()} disabled={beginPending}>검토 시작</button>
          <button type="button" onClick={() => void approve()} disabled={approvePending || !review}>최종 승인</button>
        </div>
        {reviewMutationError && (
          <p role="alert" data-testid="review-mutation-error" data-error-code={reviewMutationError.code} className="text-red-300">
            {reviewMutationError.message}
            {errorDetailLabel(reviewMutationError.details) && <span> ({errorDetailLabel(reviewMutationError.details)})</span>}
          </p>
        )}
      </section>

      <form onSubmit={(event) => event.preventDefault()} className="flex gap-3">
        <label>상태 <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AssetMappingStatus | "")}>
          <option value="">전체</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>유형 <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AssetType | "")}>
          <option value="">전체</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>장면 <select value={sceneFilter} onChange={(event) => setSceneFilter(event.target.value ? (Number(event.target.value) as SceneNumber) : "")}>
          <option value="">전체</option>
          {SCENE_NUMBERS.map((number) => <option key={number} value={number}>{number}</option>)}
        </select></label>
      </form>

      {mappingsLoading && !mappings && <p>Mapping을 불러오는 중...</p>}
      {mappingsError && (
        <p role="alert" data-testid="mappings-error" data-error-code={mappingsError.code} className="text-red-300">{mappingsError.message}</p>
      )}
      {mappings && mappings.length === 0 && !mappingsLoading && <p>등록된 Asset Mapping이 없습니다.</p>}

      {mappings && mappings.length > 0 && (
        <ul aria-label="Mapping 목록" className="space-y-3">
          {filteredMappings.map((mapping) => {
            const asset = assets[mapping.assetId];
            const assetError = assetErrors[mapping.assetId];
            const decisionBusyNow = decisionPendingIds.has(mapping.mappingId);
            const snapshotBusyNow = snapshotPendingIds.has(mapping.mappingId);
            return (
              <li key={mapping.mappingId} className="rounded border border-white/10 p-3">
                {asset ? (
                  <>
                    {asset.imageAvailable && asset.contentUrl && <img src={asset.contentUrl} alt="" className="h-20 w-32 object-cover" />}
                    <strong>{asset.displayName}</strong>
                    <span> · {TYPE_LABELS[asset.assetType]}</span>
                  </>
                ) : assetError ? (
                  <p role="alert" data-testid={`asset-error-${mapping.mappingId}`} data-error-code={assetError.code}>{assetError.message}</p>
                ) : (
                  <p>에셋 정보를 불러오는 중...</p>
                )}
                <p>Mapping ID: {mapping.mappingId}</p>
                <p>역할: {mapping.usageRole}</p>
                <p>범위: {scopeLabel(mapping.sceneScope)}</p>
                <p>상태: {STATUS_LABELS[mapping.status]}</p>
                <p>출처: {mapping.assignmentSource}</p>
                <p>버전 정책: {mapping.versionPolicy}{mapping.pinnedVersion !== null ? ` (v${mapping.pinnedVersion})` : ""}</p>
                <p>스냅샷: {mapping.snapshot ? `v${mapping.snapshot.sourceVersion} · ${mapping.snapshot.sha256.slice(0, 12)}...` : "없음"}</p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => void decide(mapping.mappingId, "confirm")} disabled={decisionBusyNow}>확인</button>
                  <button type="button" onClick={() => void decide(mapping.mappingId, "exclude")} disabled={decisionBusyNow}>제외</button>
                  <button type="button" onClick={() => void createSnapshot(mapping.mappingId)} disabled={snapshotBusyNow}>스냅샷 생성</button>
                </div>
                {decisionErrors[mapping.mappingId] && (
                  <p role="alert" data-testid={`decision-error-${mapping.mappingId}`} data-error-code={decisionErrors[mapping.mappingId]!.code} className="text-red-300">
                    {decisionErrors[mapping.mappingId]!.message}
                  </p>
                )}
                {snapshotErrors[mapping.mappingId] && (
                  <p role="alert" data-testid={`snapshot-error-${mapping.mappingId}`} data-error-code={snapshotErrors[mapping.mappingId]!.code} className="text-red-300">
                    {snapshotErrors[mapping.mappingId]!.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
