import { useEffect, useRef, useState } from "react";
import { MAX_SCENE_COUNT, sceneNumbersFor } from "@ai-animation-studio/shared";
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
import { formatDateTime } from "../utils/formatDateTime.js";
import { Spinner } from "./Spinner.js";

interface Props {
  projectId: string;
  onBack: () => void;
  /** The next pipeline step (장면 이미지). Optional so the screen still renders standalone in tests. */
  onOpenImageGeneration?: (projectId: string) => void;
}

type DisplayError = { code: string; message: string; details?: Record<string, unknown> };

const STATUS_LABELS: Record<AssetMappingStatus, string> = {
  confirmed: "확인됨", suggested: "제안됨", ambiguous: "모호함",
  unmatched: "매칭 안됨", excluded: "제외됨", invalid: "유효하지 않음",
};
const STATUS_TEXT_TONE: Record<AssetMappingStatus, string> = {
  confirmed: "text-emerald-300", suggested: "text-violet-300", ambiguous: "text-amber-300",
  unmatched: "text-slate-400", excluded: "text-rose-300", invalid: "text-rose-300",
};
const TYPE_LABELS: Record<AssetType, string> = {
  character: "캐릭터", style: "스타일", background: "배경", object: "오브젝트", general_reference: "일반 참고",
};
// A filter option list, not tied to any one project's actual scene count — offers the full supported range
// (2-12, see docs/02_MIGRATION_PLAN.md) so it works regardless of which project is open.
const SCENE_NUMBERS: readonly SceneNumber[] = sceneNumbersFor(MAX_SCENE_COUNT);

const outlineButton =
  "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent";
const selectClassName =
  "mt-1 rounded-lg border border-white/10 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

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
    return `이미지가 안 붙은 장면: ${details.missingSceneNumbers.join(", ")}번`;
  }
  if (Array.isArray(details.mappingIds) && details.mappingIds.length > 0) {
    return `아직 확인 안 한 연결 ${details.mappingIds.length}개`;
  }
  return null;
}

/**
 * The backend answers all three blocking situations with one code, so the screen — which knows the mapping
 * list — says which one it is. Without this, a project with nothing connected got told that "확인이 필요한
 * Mapping이 남아 있습니다" while the list right below it said there were none.
 */
function blockedReason(mappings: ProjectAssetMapping[] | null, details: Record<string, unknown> | undefined): string | null {
  if (Array.isArray(details?.missingSceneNumbers) && details!.missingSceneNumbers.length > 0) {
    return "이미지가 하나도 안 붙은 장면이 있습니다. 그 장면에 이미지를 연결하거나, 아래 \"특별한 경우\"에서 이미지 없이 진행하도록 켜 주세요.";
  }
  if (mappings && mappings.length === 0) {
    return "참고 이미지를 하나도 연결하지 않았습니다. 글만으로 그림을 만들려면 아래 \"참고 이미지 없이 진행하기\"를 눌러 주세요.";
  }
  return "아직 확인하지 않은 연결이 남아 있습니다. 아래 목록에서 확인 또는 제외를 눌러 주세요.";
}

export function MappingReviewScreen({ projectId, onBack, onOpenImageGeneration }: Props) {
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

  /**
   * The whole "nothing to connect" path in one press. It used to require finding a checkbox called
   * "텍스트만 사용(매핑 없음) 확인", ticking it, pressing 검토 시작, then pressing 최종 승인 — four steps to say
   * "I have no reference images". The two requests still happen, just not as two things to figure out.
   */
  async function proceedWithoutImages() {
    if (beginBusy.current || approveBusy.current) return;
    beginBusy.current = true; setBeginPending(true); setReviewMutationError(null);
    try {
      const begun = await beginProjectAssetMappingReview(projectId, {
        scriptRevision: review?.scriptRevision ?? 0,
        textOnlyConfirmed: true,
        legacyConfirmed,
      });
      setReview(begun.review);
      setTextOnlyConfirmed(true);
      const approved = await approveProjectAssetMappingReview(projectId, { scriptFingerprint: begun.review.scriptFingerprint });
      setReview(approved.review);
    } catch (caught) {
      setReviewMutationError(toMappingDisplayError(caught));
    } finally { beginBusy.current = false; setBeginPending(false); }
  }

  async function approve() {
    if (approveBusy.current || !review) return;
    approveBusy.current = true;
    setApprovePending(true);
    setReviewMutationError(null);
    try {
      const response = await approveProjectAssetMappingReview(projectId, { scriptFingerprint: review.scriptFingerprint });
      setReview(response.review);
      // The button said "다음 단계로" and then went nowhere — it only refreshed a status line that, on a
      // second visit, already read 승인됨. Nothing on screen changed, so it read as a dead button.
      if (response.review.status === "approved") onOpenImageGeneration?.(projectId);
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
    <section className="mt-8 max-w-5xl space-y-6">
      <header className="space-y-1.5">
        <button type="button" className="text-xs text-slate-400 hover:text-slate-300" onClick={onBack}>
          <span aria-hidden="true">←</span> 프로젝트로 돌아가기
        </button>
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
            참고 이미지 연결 검토
          </h1>
          <button type="button" className={outlineButton} onClick={() => void load()}>새로고침</button>
        </div>
      </header>

      {/* The old copy said these connections were made "자동으로" — nothing in this codebase auto-matches an
          Asset to a scene. Every row here was connected by hand (or migrated from the old Python data), and a
          hand-made connection is already confirmed the moment it is saved. Saying otherwise made the button
          below read as "confirm what the AI guessed", which is why it felt like a pointless second step. */}
      <p className="text-sm text-slate-400">
        각 장면이 어떤 이미지를 참고할지 정해둔 목록입니다. <strong className="text-slate-200">직접 연결한 것은 연결하는 순간 확정</strong>됩니다 — 여기서 다시 승인할 필요는 없습니다.
      </p>
      {/* "참고 이미지"가 프로젝트 설정의 등장 캐릭터·분위기 Asset과 같은 것인지 헷갈린다는 지적을 받았다. 실제로
          둘은 완전히 다른 경로다: 설정 쪽 셋은 대본 프롬프트의 텍스트 자리표시자로만 들어가고
          (story-prompt.service.ts의 character_cast_metadata / atmosphere_asset_metadata /
          scene_reference_asset_metadata), 그림을 만들 때 실제 이미지 파일로 붙는 것은 이 화면의 연결뿐이다
          (image-reference-selection.ts가 confirmed·enabled 매핑만 읽는다). 이름이 비슷해서 생긴 오해라
          화면에서 직접 구분해 준다. */}
      <div data-testid="reference-image-definition" className="rounded-xl border border-white/10 bg-slate-950/40 p-3.5 text-sm text-slate-400">
        <p className="font-medium text-slate-300">여기서 말하는 &quot;참고 이미지&quot;란</p>
        <p className="mt-1">
          그림을 만들 때 AI에게 <strong className="text-slate-200">실제 이미지 파일로 함께 보내는 것</strong>입니다. 장면마다 따로 정합니다.
        </p>
        <p className="mt-2">
          프로젝트 설정의 <span className="text-slate-300">등장 캐릭터</span>·<span className="text-slate-300">전체 분위기 Asset</span>·
          <span className="text-slate-300">장면 참고 Asset</span>은 <strong className="text-slate-200">이것과 다릅니다</strong> —
          그쪽은 <strong className="text-slate-200">대본을 쓸 때 글로만</strong> 전달되고, 그림 만들 때 이미지로 붙지는 않습니다.
          설정에서 골랐다고 이 목록에 자동으로 올라오지 않습니다.
        </p>
      </div>
      <p className="text-sm text-slate-400">
        아래 버튼이 하는 일은 두 가지입니다: <strong className="text-slate-200">빠진 장면이 없는지 검사</strong>하고, 통과하면 다음 단계로 넘깁니다.
        이미지가 하나도 안 붙은 장면이 있으면 몇 번 장면인지 알려주고 막습니다.
      </p>

      <section aria-label="검토 상태" className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
        {reviewLoading && !review && <Spinner label="검토 상태를 불러오는 중..." />}
        {reviewError && (
          <p role="alert" data-testid="review-error" data-error-code={reviewError.code} className="text-sm text-rose-400">{reviewError.message}</p>
        )}
        {review && (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              <div><dt className="inline text-slate-400">상태: </dt><dd className="inline font-medium text-slate-100">{review.status === "approved" ? "승인됨" : "대기 중"}</dd></div>
              {review.status === "approved" && review.approvedAt && (
                <div><dt className="inline text-slate-400">승인 시각: </dt><dd className="inline font-medium text-slate-100 tabular-nums" title={review.approvedAt}>{formatDateTime(review.approvedAt)}</dd></div>
              )}
              <div className="sm:col-span-2"><dt className="inline text-slate-400">검토된 장면: </dt><dd className="inline font-medium text-slate-100">{review.reviewedScenes.join(", ") || "없음"}</dd></div>
            </dl>
            {/* Revision numbers and the script fingerprint are how the backend decides whether an approval is
                stale. Real, and worth having when something goes wrong — but nothing a person acts on, and
                four lines of hex at the top of a screen makes the screen look like a debugger. Kept, folded. */}
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-300">자세한 기술 정보</summary>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <div><dt className="inline text-slate-400">Mapping Revision: </dt><dd className="inline font-medium text-slate-100">{review.mappingRevision}</dd></div>
                <div><dt className="inline text-slate-400">Script Revision: </dt><dd className="inline font-medium text-slate-100">{review.scriptRevision}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-slate-400">Fingerprint: </dt><dd className="inline break-all font-medium text-slate-100">{review.scriptFingerprint || "없음"}</dd></div>
              </dl>
            </details>
          </>
        )}
        {mappings && mappings.length === 0 && review?.status !== "approved" && (
          <div data-testid="mapping-no-images" className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3.5">
            <p className="text-sm text-amber-200">참고할 이미지를 하나도 연결하지 않았습니다.</p>
            <p className="text-xs text-slate-400">
              이대로 진행하면 그림은 글 설명만으로 만들어집니다. 특정 캐릭터·배경을 그대로 쓰고 싶으면 먼저 이미지를 연결해 주세요.
            </p>
            <button type="button" className={outlineButton} disabled={beginPending || approvePending} onClick={() => void proceedWithoutImages()}>
              {beginPending ? "진행하는 중…" : "참고 이미지 없이 진행하기"}
            </button>
          </div>
        )}

        {/* Rare paths. Leaving them open as the first two controls made every visit look like a form to fill in. */}
        <details className="space-y-1.5 text-sm">
          <summary className="cursor-pointer text-slate-400 hover:text-slate-300">특별한 경우</summary>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="accent-violet-500" checked={textOnlyConfirmed} disabled={beginPending} onChange={(event) => setTextOnlyConfirmed(event.target.checked)} /> 이미지 없이 진행하겠습니다
          </label>
          <p className="pl-6 text-xs text-slate-500">참고할 이미지를 하나도 안 붙이고 글만으로 그림을 만들 때 켜세요. 켜면 빠진 장면 검사를 건너뜁니다.</p>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="accent-violet-500" checked={legacyConfirmed} disabled={beginPending} onChange={(event) => setLegacyConfirmed(event.target.checked)} /> 예전 프로젝트에서 옮겨온 연결을 그대로 쓰겠습니다
          </label>
          <p className="pl-6 text-xs text-slate-500">예전 버전에서 만들어 둔 연결이 이미 있을 때만 씁니다. 새로 만든 프로젝트라면 끈 채로 두세요.</p>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={outlineButton} onClick={() => void beginReview()} disabled={beginPending}>지금 대본 기준으로 다시 맞추기</button>
          <span className="text-xs text-slate-500">대본을 고쳤다면 눌러 주세요. 바뀐 대본에 맞춰 검사 기준을 새로 잡습니다.</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="approve-review-button"
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
            onClick={() => void approve()}
            disabled={approvePending || !review}
          >
            {approvePending ? "검사하는 중…" : review?.status === "approved" ? "다시 검사하고 다음 단계로" : "연결 다 했음 · 다음 단계로"}
          </button>
          {/* Already approved once: re-running the check is a choice, not a requirement. Moving on needs its
              own button, or the only way forward is one whose label implies work that is already done. */}
          {review?.status === "approved" && onOpenImageGeneration && (
            <button
              type="button"
              data-testid="skip-to-image-generation"
              className={outlineButton}
              disabled={approvePending}
              onClick={() => onOpenImageGeneration(projectId)}
            >
              그냥 다음 단계로
            </button>
          )}
          <span className="text-xs text-slate-500">
            {review?.status === "approved"
              ? "이미 승인된 상태입니다. 연결을 고쳤다면 다시 검사하고, 아니면 그냥 넘어가면 됩니다."
              : "빠진 장면이 없는지 검사하고 다음 단계로 넘어갑니다."}
          </span>
        </div>
        {reviewMutationError && (
          <div role="alert" data-testid="review-mutation-error" data-error-code={reviewMutationError.code}>
            <p className="text-sm text-rose-400">
              {reviewMutationError.message}
              {errorDetailLabel(reviewMutationError.details) && <span> ({errorDetailLabel(reviewMutationError.details)})</span>}
            </p>
            {reviewMutationError.code === "ASSET_MAPPING_APPROVAL_BLOCKED" && (
              <p data-testid="review-blocked-reason" className="mt-1 text-sm text-amber-300">
                {blockedReason(mappings, reviewMutationError.details)}
              </p>
            )}
          </div>
        )}
      </section>

      <form onSubmit={(event) => event.preventDefault()} className="flex flex-wrap gap-4">
        <label className="text-sm text-slate-300">상태
          <select className={`block ${selectClassName}`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AssetMappingStatus | "")}>
            <option value="">전체</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-300">유형
          <select className={`block ${selectClassName}`} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as AssetType | "")}>
            <option value="">전체</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-300">장면
          <select className={`block ${selectClassName}`} value={sceneFilter} onChange={(event) => setSceneFilter(event.target.value ? (Number(event.target.value) as SceneNumber) : "")}>
            <option value="">전체</option>
            {SCENE_NUMBERS.map((number) => <option key={number} value={number}>{number}</option>)}
          </select>
        </label>
      </form>

      {mappingsLoading && !mappings && <Spinner label="Mapping을 불러오는 중..." />}
      {mappingsError && (
        <p role="alert" data-testid="mappings-error" data-error-code={mappingsError.code} className="text-sm text-rose-400">{mappingsError.message}</p>
      )}
      {mappings && mappings.length === 0 && !mappingsLoading && <p className="text-slate-400">등록된 참고 이미지 연결이 없습니다.</p>}

      {mappings && mappings.length > 0 && (
        <ul aria-label="Mapping 목록" className="space-y-3">
          {filteredMappings.map((mapping) => {
            const asset = assets[mapping.assetId];
            const assetError = assetErrors[mapping.assetId];
            const decisionBusyNow = decisionPendingIds.has(mapping.mappingId);
            const snapshotBusyNow = snapshotPendingIds.has(mapping.mappingId);
            return (
              <li key={mapping.mappingId} className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                {asset ? (
                  <div className="flex items-baseline gap-2">
                    {asset.imageAvailable && asset.contentUrl && (
                      <img src={asset.contentUrl} alt="" className="mr-1 h-20 w-32 flex-shrink-0 rounded-xl border border-white/10 object-cover" />
                    )}
                    <strong className="font-semibold text-slate-100">{asset.displayName}</strong>
                    <span className="text-sm text-slate-400"> · {TYPE_LABELS[asset.assetType]}</span>
                  </div>
                ) : assetError ? (
                  <p role="alert" data-testid={`asset-error-${mapping.mappingId}`} data-error-code={assetError.code} className="text-sm text-rose-400">{assetError.message}</p>
                ) : (
                  <Spinner label="에셋 정보를 불러오는 중..." />
                )}
                <div className="space-y-0.5 text-sm text-slate-400">
                  <p>역할: {mapping.usageRole}</p>
                  <p>범위: {scopeLabel(mapping.sceneScope)}</p>
                  <p className={STATUS_TEXT_TONE[mapping.status]}>상태: {STATUS_LABELS[mapping.status]}</p>
                  {/* Mapping id, assignment source and version policy are storage-level facts. They matter when
                      something has to be matched up by hand; they are noise on every other row. */}
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-400">자세한 기술 정보</summary>
                    <div className="mt-1 space-y-0.5 text-xs">
                      <p>Mapping ID: {mapping.mappingId}</p>
                      <p>출처: {mapping.assignmentSource}</p>
                      <p>버전 정책: {mapping.versionPolicy}{mapping.pinnedVersion !== null ? ` (v${mapping.pinnedVersion})` : ""}</p>
                      <p>스냅샷: {mapping.snapshot ? `v${mapping.snapshot.sourceVersion} · ${mapping.snapshot.sha256.slice(0, 12)}...` : "없음"}</p>
                    </div>
                  </details>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {/* A row you connected yourself arrives already confirmed, so this button would change nothing
                      — offering it is what made the screen feel like it was asking twice. It stays for rows that
                      really are unresolved (migrated data, or a mapping invalidated by a script change). */}
                  {mapping.status !== "confirmed" && (
                    <button type="button" className={`${outlineButton} border-emerald-400/30 text-emerald-300`} onClick={() => void decide(mapping.mappingId, "confirm")} disabled={decisionBusyNow}>확인</button>
                  )}
                  <button type="button" className={`${outlineButton} border-rose-400/30 text-rose-300`} onClick={() => void decide(mapping.mappingId, "exclude")} disabled={decisionBusyNow}>제외</button>
                  <button type="button" className={outlineButton} onClick={() => void createSnapshot(mapping.mappingId)} disabled={snapshotBusyNow}>스냅샷 생성</button>
                  <span className="text-xs text-slate-500">
                    {mapping.status === "confirmed" ? "제외: 이 연결을 쓰지 않음" : "확인: 이 연결을 그대로 사용 · 제외: 이 연결을 쓰지 않음"} · 스냅샷 생성: 지금 이미지 버전을 이 장면에 고정
                  </span>
                </div>
                {decisionErrors[mapping.mappingId] && (
                  <p role="alert" data-testid={`decision-error-${mapping.mappingId}`} data-error-code={decisionErrors[mapping.mappingId]!.code} className="text-sm text-rose-400">
                    {decisionErrors[mapping.mappingId]!.message}
                  </p>
                )}
                {snapshotErrors[mapping.mappingId] && (
                  <p role="alert" data-testid={`snapshot-error-${mapping.mappingId}`} data-error-code={snapshotErrors[mapping.mappingId]!.code} className="text-sm text-rose-400">
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
