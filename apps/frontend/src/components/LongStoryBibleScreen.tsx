import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Asset, LongStoryBible, LongStoryBibleAssetLink, LongStoryBibleCollection, LongStoryBibleItem, LongStoryBibleItemInput, LongStoryBibleRelationshipIssue, LongStoryBibleStyleAssetLink } from "@ai-animation-studio/shared";

import { createLongStoryBibleItem, deleteLongStoryBibleItem, duplicateLongStoryBibleItem, getLongProjectStoryBible, getLongStoryBibleRelationshipAudit, searchLongStoryBibleItems, toLongStoryBibleDisplayError, updateLongStoryBibleContent, updateLongStoryBibleItem, updateLongStoryBibleStyleAssetLink } from "../api/longStoryBibleApi.js";
import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { getLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; onBack: () => void; }
type DisplayError = { code: string; message: string };
const TABS: Array<{ value: LongStoryBibleCollection; label: string }> = [
  { value: "characters", label: "캐릭터" }, { value: "locations", label: "장소" }, { value: "props", label: "소품" },
  { value: "secrets", label: "비밀" }, { value: "foreshadowing", label: "복선" },
];
const ASSET_LINK_COLLECTIONS: readonly LongStoryBibleCollection[] = ["characters", "locations", "props"];

const compactField =
  "rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const fieldClassName = `mt-1.5 w-full ${compactField}`;
const jsonFieldClassName =
  "mt-1.5 min-h-28 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const dangerButton =
  "rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(225,29,72,0.3)] disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAddButton =
  "rounded-full border border-emerald-400/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50";
const smallRemoveButton =
  "rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2.5 text-base font-semibold">
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
      />
      {children}
    </h3>
  );
}

function itemInput(item: LongStoryBibleItem): LongStoryBibleItemInput {
  const { id: _id, ...input } = item;
  return input;
}

export function LongStoryBibleScreen({ projectId, onBack }: Props) {
  const [bible, setBible] = useState<LongStoryBible | null>(null);
  const [collection, setCollection] = useState<LongStoryBibleCollection>("characters");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);
  const [name, setName] = useState("");
  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<LongStoryBibleItem | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LongStoryBibleItem | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetLoading, setAssetLoading] = useState(true);
  const [episodeCount, setEpisodeCount] = useState<number | null>(null);
  const [assetId, setAssetId] = useState("");
  const [versionPolicy, setVersionPolicy] = useState<LongStoryBibleAssetLink["versionPolicy"]>("pinned_version");
  const [scopeMode, setScopeMode] = useState<"all" | "episode">("all");
  const [scopeEpisode, setScopeEpisode] = useState("1");
  const [relationshipAudit, setRelationshipAudit] = useState<LongStoryBibleRelationshipIssue[] | null>(null);
  const [relationshipAuditLoading, setRelationshipAuditLoading] = useState(false);
  const [relationshipAuditError, setRelationshipAuditError] = useState<DisplayError | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LongStoryBibleItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<DisplayError | null>(null);
  const [duplicateError, setDuplicateError] = useState<DisplayError | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [basicDraft, setBasicDraft] = useState("{}");
  const [worldDraft, setWorldDraft] = useState("{}");
  const [contentValidationError, setContentValidationError] = useState<string | null>(null);
  const [styleAssetId, setStyleAssetId] = useState("");
  const [styleVersionPolicy, setStyleVersionPolicy] = useState<LongStoryBibleStyleAssetLink["versionPolicy"]>("pinned_version");
  const busy = useRef(false);
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [bibleResult, assetsResult, projectResult] = await Promise.allSettled([
        getLongProjectStoryBible(projectId), listAssets(), getLongProject(projectId),
      ]);
      if (version !== loadVersion.current) return;
      if (bibleResult.status === "fulfilled") {
        setBible(bibleResult.value.storyBible); setError(null);
        setBasicDraft(JSON.stringify(bibleResult.value.storyBible.basic, null, 2));
        setWorldDraft(JSON.stringify(bibleResult.value.storyBible.world, null, 2));
        setStyleAssetId(bibleResult.value.storyBible.styleAssetLink?.assetId ?? "");
        setStyleVersionPolicy(bibleResult.value.storyBible.styleAssetLink?.versionPolicy ?? "pinned_version");
      }
      else setError(toLongStoryBibleDisplayError(bibleResult.reason));
      if (assetsResult.status === "fulfilled") {
        setAssets(assetsResult.value.assets.filter((asset) => asset.enabled && asset.approved && !asset.isFolder));
      } else setError(toAssetDisplayError(assetsResult.reason));
      setAssetLoading(false);
      if (projectResult.status === "fulfilled") setEpisodeCount(projectResult.value.project.episodeCount);
      else setError(toLongProjectDisplayError(projectResult.reason));
    } catch (caught) {
      if (version === loadVersion.current) setError(toLongStoryBibleDisplayError(caught));
    } finally { if (version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function loadRelationshipAudit(): Promise<void> {
    if (relationshipAuditLoading) return;
    setRelationshipAuditLoading(true); setRelationshipAuditError(null);
    try { setRelationshipAudit((await getLongStoryBibleRelationshipAudit(projectId)).issues); }
    catch (caught) { setRelationshipAuditError(toLongStoryBibleDisplayError(caught)); }
    finally { setRelationshipAuditLoading(false); }
  }

  async function search(): Promise<void> {
    if (!searchQuery.trim() || searchLoading) return;
    setSearchLoading(true); setSearchError(null);
    try { setSearchResults((await searchLongStoryBibleItems(projectId, collection, searchQuery.trim())).items); }
    catch (caught) { setSearchError(toLongStoryBibleDisplayError(caught)); }
    finally { setSearchLoading(false); }
  }

  async function duplicate(item: LongStoryBibleItem): Promise<void> {
    if (duplicatingId || pending) return;
    setDuplicatingId(item.id); setDuplicateError(null);
    try {
      const response = await duplicateLongStoryBibleItem(projectId, collection, item.id);
      setBible(response.storyBible);
      setSearchResults((current) => current === null ? current : [...current, response.item]);
    } catch (caught) { setDuplicateError(toLongStoryBibleDisplayError(caught)); }
    finally { setDuplicatingId(null); }
  }

  function parseContentDraft(value: string, label: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch { setContentValidationError(`${label}은(는) JSON 객체 형식이어야 합니다.`); return null; }
  }
  async function saveContent(): Promise<void> {
    if (busy.current) return;
    const basic = parseContentDraft(basicDraft, "기본 설정");
    const world = parseContentDraft(worldDraft, "세계관 설정");
    if (!basic || !world) return;
    setContentValidationError(null); busy.current = true; setPending(true);
    try {
      const response = await updateLongStoryBibleContent(projectId, { basic, world });
      setBible(response.storyBible); setBasicDraft(JSON.stringify(response.storyBible.basic, null, 2)); setWorldDraft(JSON.stringify(response.storyBible.world, null, 2)); setError(null);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }
  function selectedStyleAsset(): Asset | undefined { return assets.find((asset) => asset.assetId === styleAssetId); }
  async function saveStyleAssetLink(): Promise<void> {
    if (busy.current) return;
    const asset = selectedStyleAsset();
    if (styleAssetId && !asset) { setContentValidationError("사용 가능한 스타일 Asset Library 항목을 선택하세요."); return; }
    setContentValidationError(null); busy.current = true; setPending(true);
    try {
      const assetLink = asset ? { assetId: asset.assetId, versionPolicy: styleVersionPolicy, pinnedVersion: asset.version } : null;
      const response = await updateLongStoryBibleStyleAssetLink(projectId, { assetLink });
      setBible(response.storyBible); setStyleAssetId(response.storyBible.styleAssetLink?.assetId ?? ""); setStyleVersionPolicy(response.storyBible.styleAssetLink?.versionPolicy ?? "pinned_version"); setError(null);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  function resetEditor(): void {
    setName(""); setItemId(""); setDescription(""); setStatus(""); setEditing(null); setValidationError(null);
    setAssetId(""); setVersionPolicy("pinned_version"); setScopeMode("all"); setScopeEpisode("1");
  }
  function startEdit(item: LongStoryBibleItem): void {
    setEditing(item); setName(item.name ?? ""); setItemId(item.id); setDescription(item.description ?? ""); setStatus(item.status ?? ""); setValidationError(null); setDeleteTarget(null);
    setAssetId(item.assetLink?.assetId ?? ""); setVersionPolicy(item.assetLink?.versionPolicy ?? "pinned_version");
    setScopeMode(item.assetLink?.episodeScope.mode ?? "all"); setScopeEpisode(item.assetLink?.episodeScope.mode === "episode" ? String(item.assetLink.episodeScope.episode) : "1");
  }
  function selectedAsset(): Asset | undefined { return assets.find((asset) => asset.assetId === assetId); }
  function assetLinkDraft(): LongStoryBibleAssetLink | undefined {
    if (!assetId) return undefined;
    const asset = selectedAsset();
    if (!asset) return editing?.assetLink?.assetId === assetId ? editing.assetLink : undefined;
    const episode = Number(scopeEpisode);
    return {
      assetId, versionPolicy, pinnedVersion: versionPolicy === "pinned_version" ? asset.version : null,
      episodeScope: scopeMode === "episode" && Number.isInteger(episode) && episode >= 1 ? { mode: "episode", episode } : { mode: "all" },
    };
  }
  function draft(): LongStoryBibleItemInput {
    const link = assetLinkDraft();
    return {
      ...(itemId.trim() ? { id: itemId.trim() } : {}), name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}), ...(status.trim() ? { status: status.trim() } : {}),
      ...(ASSET_LINK_COLLECTIONS.includes(collection) && link ? { assetLink: link } : {}),
      ...(ASSET_LINK_COLLECTIONS.includes(collection) && editing && !assetId ? { assetLink: null } : {}),
    };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (!name.trim()) { setValidationError("이름을 입력하세요."); return; }
    setValidationError(null); busy.current = true; setPending(true);
    try {
      if (editing) {
        const response = await updateLongStoryBibleItem(projectId, collection, editing.id, { item: { ...itemInput(editing), ...draft() } });
        setBible(response.storyBible);
      } else {
        const response = await createLongStoryBibleItem(projectId, collection, { item: draft() });
        setBible(response.storyBible);
      }
      setError(null); resetEditor();
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }
  async function confirmDelete() {
    if (!deleteTarget || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const response = await deleteLongStoryBibleItem(projectId, collection, deleteTarget.id);
      setBible(response.storyBible); setError(null); setDeleteTarget(null);
      if (editing?.id === deleteTarget.id) resetEditor();
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }
  const items = bible?.[collection] ?? [];
  const collectionLabel = TABS.find((tab) => tab.value === collection)?.label ?? collection;
  const supportsAssetLink = ASSET_LINK_COLLECTIONS.includes(collection);
  const styleAssets = assets.filter((asset) => asset.assetType === "style");

  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        Story Bible
      </h2>
      <p className="text-sm text-slate-400">이 장기 프로젝트의 캐릭터와 세계관 설정 자료를 로컬에서 정리합니다.</p>
      {error && (
        <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}

      <section aria-label="기본·세계관 설정" className={cardSection}>
        <SectionHeading>기본·세계관 설정</SectionHeading>
        <p className="text-sm text-slate-400">Story Bible의 맥락으로 쓰이는 로컬 JSON 데이터를 편집합니다. 저장해도 대본·이미지·영상은 생성되지 않습니다.</p>
        {contentValidationError && (
          <p role="alert" data-testid="story-bible-content-validation-error" className="text-sm text-rose-400">
            {contentValidationError}
          </p>
        )}
        <label className="block text-sm text-slate-300">
          기본 설정 JSON
          <textarea
            aria-label="기본 설정 JSON"
            value={basicDraft}
            disabled={pending}
            onChange={(event) => { setBasicDraft(event.target.value); setContentValidationError(null); }}
            className={jsonFieldClassName}
          />
        </label>
        <label className="block text-sm text-slate-300">
          세계관 설정 JSON
          <textarea
            aria-label="세계관 설정 JSON"
            value={worldDraft}
            disabled={pending}
            onChange={(event) => { setWorldDraft(event.target.value); setContentValidationError(null); }}
            className={jsonFieldClassName}
          />
        </label>
        <button type="button" className={outlineButton} onClick={() => void saveContent()} disabled={pending}>
          {pending ? "저장하는 중..." : "기본·세계관 설정 저장"}
        </button>
      </section>

      <section aria-label="전체 비주얼 스타일 Asset Library 연결" className={cardSection}>
        <SectionHeading>전체 비주얼 스타일</SectionHeading>
        <p className="text-sm text-slate-400">원하면 이 프로젝트 전체에 적용할 승인된 스타일 에셋 하나를 연결할 수 있습니다.</p>
        {assetLoading && <p className="text-sm text-slate-400">사용 가능한 스타일 에셋을 불러오는 중...</p>}
        {!assetLoading && styleAssets.length === 0 && <p className="text-sm text-slate-400">승인되고 사용 설정된 스타일 에셋이 없습니다.</p>}
        <label className="block text-sm text-slate-300">
          스타일 에셋
          <select
            aria-label="전체 스타일 에셋"
            value={styleAssetId}
            disabled={pending || assetLoading}
            onChange={(event) => setStyleAssetId(event.target.value)}
            className={fieldClassName}
          >
            <option value="">전체 스타일 없음</option>
            {styleAssets.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>
                {asset.displayName} ({asset.assetId}) · v{asset.version}
              </option>
            ))}
          </select>
        </label>
        {styleAssetId && (
          <label className="block text-sm text-slate-300">
            스타일 버전 정책
            <select
              aria-label="전체 스타일 버전 정책"
              value={styleVersionPolicy}
              disabled={pending}
              onChange={(event) => setStyleVersionPolicy(event.target.value as LongStoryBibleStyleAssetLink["versionPolicy"])}
              className={fieldClassName}
            >
              <option value="pinned_version">현재 버전 고정</option>
              <option value="follow_latest">최신 버전 따라가기</option>
              <option value="snapshot">현재 버전 스냅샷</option>
            </select>
          </label>
        )}
        {bible?.styleAssetLink && (
          <p data-testid="global-style-asset-link" className="text-sm text-emerald-300">
            연결된 스타일: {bible.styleAssetLink.assetId} · {bible.styleAssetLink.versionPolicy} · v{bible.styleAssetLink.pinnedVersion}
          </p>
        )}
        <button type="button" className={outlineButton} onClick={() => void saveStyleAssetLink()} disabled={pending || assetLoading}>
          {pending ? "저장하는 중..." : styleAssetId ? "전체 스타일 저장" : "전체 스타일 빼기"}
        </button>
      </section>

      <section aria-label="Story Bible 연결 상태 점검" className={cardSection}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionHeading>연결 상태 점검</SectionHeading>
            <p className="text-sm text-slate-400">Story Bible에서 빠진 연결이 없는지 조회만 하는 점검입니다.</p>
          </div>
          <button type="button" className={outlineButton} onClick={() => void loadRelationshipAudit()} disabled={relationshipAuditLoading}>
            {relationshipAuditLoading ? "확인하는 중..." : relationshipAudit === null ? "연결 상태 확인" : "다시 확인"}
          </button>
        </div>
        {relationshipAuditLoading && <p className="text-sm text-slate-400">Story Bible 연결 상태를 확인하는 중...</p>}
        {relationshipAuditError && (
          <div className="space-y-2">
            <p role="alert" data-error-code={relationshipAuditError.code} className="text-sm text-rose-400">
              {relationshipAuditError.message}
            </p>
            <button type="button" className={smallOutlineButton} onClick={() => void loadRelationshipAudit()} disabled={relationshipAuditLoading}>
              다시 시도
            </button>
          </div>
        )}
        {relationshipAudit && relationshipAudit.length === 0 && (
          <p data-testid="relationship-audit-healthy" className="text-sm text-emerald-300">
            Story Bible 연결 상태에 문제가 없습니다.
          </p>
        )}
        {relationshipAudit && relationshipAudit.length > 0 && (
          <ul aria-label="연결 상태 문제 목록" className="space-y-2">
            {relationshipAudit.map((issue, index) => (
              <li
                key={`${issue.collection}-${issue.itemId}-${issue.field}-${index}`}
                className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-2.5 text-sm text-slate-200"
              >
                <strong>{issue.collection}</strong> / {issue.itemId} / {issue.field}: {issue.missingIds.join(", ")} 항목이 빠져 있습니다
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="tablist" aria-label="Story Bible collection" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={collection === tab.value}
            onClick={() => { setCollection(tab.value); resetEditor(); setDeleteTarget(null); setSearchQuery(""); setSearchResults(null); setSearchError(null); setDuplicateError(null); }}
            className={
              collection === tab.value
                ? "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
                : "rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-300 hover:bg-white/5"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section aria-label={`${collectionLabel} 검색 영역`} className={cardSection}>
        <SectionHeading>{collectionLabel} 검색</SectionHeading>
        <p className="text-sm text-slate-400">이 항목군 안에서만 검색합니다. 검색어를 입력하고 실행해야 결과가 나옵니다.</p>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <label className="sr-only" htmlFor="story-bible-search">{collectionLabel} 검색</label>
          <input
            id="story-bible-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className={`min-w-48 flex-1 ${compactField}`}
          />
          <button type="submit" className={smallOutlineButton} disabled={searchLoading || !searchQuery.trim()}>
            {searchLoading ? "검색하는 중..." : "검색"}
          </button>
        </form>
        {searchError && (
          <div className="space-y-2">
            <p role="alert" data-error-code={searchError.code} className="text-sm text-rose-400">
              {searchError.message}
            </p>
            <button type="button" className={smallOutlineButton} onClick={() => void search()} disabled={searchLoading}>
              다시 검색
            </button>
          </div>
        )}
        {searchResults && searchResults.length === 0 && (
          <p data-testid="story-bible-search-empty" className="text-sm text-slate-400">
            일치하는 {collectionLabel} 항목이 없습니다.
          </p>
        )}
        {searchResults && searchResults.length > 0 && (
          <ul aria-label={`${collectionLabel} 검색 결과`} className="space-y-2">
            {searchResults.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-950/40 p-2.5 text-sm">
                <strong className="text-slate-100">{item.name || item.id}</strong>
                <span className="text-slate-400">{item.id}</span>
                <button type="button" className={smallAddButton} onClick={() => void duplicate(item)} disabled={Boolean(duplicatingId) || pending}>
                  {duplicatingId === item.id ? "복제하는 중..." : "복제"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {duplicateError && (
          <p role="alert" data-error-code={duplicateError.code} className="text-sm text-rose-400">
            {duplicateError.message}
          </p>
        )}
      </section>

      {loading && !bible && <Spinner label="Story Bible을 불러오는 중..." />}
      {bible && items.length === 0 && (
        <p data-testid="story-bible-empty" className="text-sm text-slate-400">
          아직 등록된 {collectionLabel} 항목이 없습니다.
        </p>
      )}
      {bible && items.length > 0 && (
        <ul aria-label={`${collectionLabel} 목록`} className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-slate-100">{item.name || item.id}</strong>
                <span className="text-xs text-slate-400">{item.id}</span>
                {item.status && <span className="text-xs text-violet-300">{item.status}</span>}
              </div>
              {item.description && <p className="mt-1 text-sm text-slate-300">{item.description}</p>}
              {item.assetLink && (
                <p data-testid={`asset-link-${item.id}`} className="mt-1 text-sm text-emerald-300">
                  Asset: {item.assetLink.assetId} · {item.assetLink.versionPolicy === "pinned_version" ? `v${item.assetLink.pinnedVersion} 고정` : "최신 버전 따라가기"} ·{" "}
                  {item.assetLink.episodeScope.mode === "all" ? "모든 에피소드" : `에피소드 ${item.assetLink.episodeScope.episode}`}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button type="button" className={smallOutlineButton} onClick={() => startEdit(item)}>
                  수정
                </button>
                <button type="button" className={smallAddButton} onClick={() => void duplicate(item)} disabled={Boolean(duplicatingId) || pending}>
                  {duplicatingId === item.id ? "복제하는 중..." : "복제"}
                </button>
                <button type="button" className={smallRemoveButton} onClick={() => setDeleteTarget(item)} disabled={pending}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        aria-label={editing ? "Story Bible 항목 수정" : "Story Bible 항목 추가"}
        onSubmit={(event) => void submit(event)}
        className="space-y-3 rounded-2xl border border-violet-400/30 bg-slate-900/70 p-5"
      >
        <SectionHeading>{editing ? "항목 수정" : "항목 추가"}</SectionHeading>
        {validationError && (
          <p role="alert" data-testid="story-bible-validation-error" className="text-sm text-rose-400">
            {validationError}
          </p>
        )}
        <label className="block text-sm text-slate-300">
          ID (선택 사항)
          <input aria-label="항목 ID" value={itemId} disabled={pending || Boolean(editing)} onChange={(event) => setItemId(event.target.value)} className={fieldClassName} />
        </label>
        <label className="block text-sm text-slate-300">
          이름
          <input
            aria-label="항목 이름"
            value={name}
            disabled={pending}
            onChange={(event) => { setName(event.target.value); setValidationError(null); }}
            className={fieldClassName}
          />
        </label>
        <label className="block text-sm text-slate-300">
          설명
          <textarea aria-label="항목 설명" value={description} disabled={pending} onChange={(event) => setDescription(event.target.value)} className={fieldClassName} />
        </label>
        <label className="block text-sm text-slate-300">
          상태
          <input aria-label="항목 상태" value={status} disabled={pending} onChange={(event) => setStatus(event.target.value)} className={fieldClassName} />
        </label>
        {supportsAssetLink && (
          <fieldset className="space-y-3 rounded-xl border border-white/10 bg-slate-950/30 p-3.5 disabled:opacity-50" disabled={pending || assetLoading}>
            <legend className="px-1 text-sm text-slate-300">Asset Library 연결(선택 사항)</legend>
            {assetLoading && <p className="text-sm text-slate-400">사용 가능한 에셋을 불러오는 중...</p>}
            {!assetLoading && assets.length === 0 && <p className="text-sm text-slate-400">승인되고 사용 설정된 Asset Library 항목이 없습니다.</p>}
            <label className="block text-sm text-slate-300">
              에셋
              <select aria-label="연결할 에셋" value={assetId} onChange={(event) => setAssetId(event.target.value)} className={fieldClassName}>
                <option value="">Asset Library 연결 없음</option>
                {assets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.displayName} ({asset.assetId}) · v{asset.version}
                  </option>
                ))}
              </select>
            </label>
            {assetId && (
              <>
                <label className="block text-sm text-slate-300">
                  버전 정책
                  <select
                    aria-label="에셋 버전 정책"
                    value={versionPolicy}
                    onChange={(event) => setVersionPolicy(event.target.value as LongStoryBibleAssetLink["versionPolicy"])}
                    className={fieldClassName}
                  >
                    <option value="pinned_version">현재 버전 고정</option>
                    <option value="follow_latest">최신 버전 따라가기</option>
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  적용 범위
                  <select
                    aria-label="에셋 적용 범위"
                    value={scopeMode}
                    onChange={(event) => setScopeMode(event.target.value as "all" | "episode")}
                    className={fieldClassName}
                  >
                    <option value="all">모든 에피소드</option>
                    <option value="episode">에피소드 하나만</option>
                  </select>
                </label>
                {scopeMode === "episode" && (
                  <label className="block text-sm text-slate-300">
                    에피소드 번호
                    <select aria-label="적용할 에피소드 번호" value={scopeEpisode} onChange={(event) => setScopeEpisode(event.target.value)} className={fieldClassName}>
                      {Array.from({ length: episodeCount ?? 0 }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          에피소드 {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </fieldset>
        )}
        <div className="flex gap-2">
          <button type="submit" className={primaryButton} disabled={pending}>
            {pending ? "저장하는 중..." : editing ? "변경 사항 저장" : "항목 추가"}
          </button>
          {editing && (
            <button type="button" className={outlineButton} onClick={resetEditor} disabled={pending}>
              취소
            </button>
          )}
        </div>
      </form>

      {deleteTarget && (
        <div role="alertdialog" aria-label="Story Bible 항목 삭제 확인" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm font-semibold text-amber-300">{deleteTarget.name || deleteTarget.id}을(를) 삭제할까요?</p>
          <p className="text-sm text-slate-300">삭제 전에 한 번 더 확인합니다.</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} onClick={() => setDeleteTarget(null)} disabled={pending}>
              취소
            </button>
            <button type="button" className={dangerButton} onClick={() => void confirmDelete()} disabled={pending}>
              {pending ? "삭제하는 중..." : "삭제"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
