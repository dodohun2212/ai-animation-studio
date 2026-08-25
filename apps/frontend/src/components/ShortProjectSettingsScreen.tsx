import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  type Asset,
  type AssetType,
  type ShortProjectCastMember,
  type ShortProjectContinuityOption,
  type ShortProjectSceneReferenceAsset,
  type ShortProjectSettings,
} from "@ai-animation-studio/shared";

import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import {
  getProjectAssetReferences, getProjectCast, getProjectContinuity, getProjectSettings, listProjectContinuityOptions, setProjectContinuity, toDisplayError,
  updateProjectAssetReferences, updateProjectCast, updateProjectSettings,
} from "../api/projectsApi.js";
import { createStoryPromptDraftPreview, toStoryDisplayError } from "../api/storyPromptApi.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; onBack: () => void; justCreated?: boolean; }
type State = { settings: ShortProjectSettings | null; loading: boolean; error: { code: string; message: string } | null };

const EMPTY_SETTINGS: ShortProjectSettings = {
  projectName: "", topic: "", genre: "미스터리", mood: "시네마틱", character: "", lore: "", fullStory: "",
  durationSeconds: 30, sceneCount: 6, clipDurationSeconds: 5, additionalNotes: "", styleNotes: { aspect: "16:9" },
};

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const inlineInput =
  "rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const dangerOutlineButton =
  "rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
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

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      {multiline ? (
        <textarea className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <input className={fieldClassName} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

/**
 * Wizard-time representative/supporting Character Asset selection (Python's `character_profile.cast`). Saves
 * through its own endpoint, separate from the plain-text settings form above, so a search or a blur-save here
 * never depends on the settings form's own save state.
 */
function CastEditor({ projectId }: { projectId: string }) {
  const [cast, setCast] = useState<ShortProjectCastMember[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Asset[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<{ code: string; message: string } | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getProjectCast(projectId).then((response) => { if (!cancelled) setCast(response.cast); })
      .catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSearchLoading(true); setSearchError(null);
    try {
      const response = await listAssets({ query: query || undefined, assetType: "character" });
      setResults(response.assets);
    } catch (caught) { setSearchError(toAssetDisplayError(caught)); }
    finally { setSearchLoading(false); }
  }

  async function persist(next: ShortProjectCastMember[]): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const response = await updateProjectCast(projectId, { cast: next });
      setCast(response.cast);
    } catch (caught) { setError(toDisplayError(caught)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function addMember(asset: Asset): void {
    if (!cast || cast.some((member) => member.assetId === asset.assetId)) return;
    void persist([...cast, { assetId: asset.assetId, castRole: "supporting", storyRole: "서브 캐릭터" }]);
  }
  function removeMember(assetId: string): void {
    if (!cast) return;
    void persist(cast.filter((member) => member.assetId !== assetId));
  }
  function updateMember(assetId: string, key: "castRole" | "storyRole", value: string): void {
    if (!cast) return;
    setCast(cast.map((member) => member.assetId === assetId ? { ...member, [key]: value } : member));
  }
  function saveMember(assetId: string): void {
    if (!cast) return;
    const member = cast.find((item) => item.assetId === assetId);
    if (!member || !member.castRole.trim() || !member.storyRole.trim()) return;
    void persist(cast);
  }

  return (
    <section aria-label="등장 캐릭터" className={cardSection}>
      <SectionHeading>등장 캐릭터(Cast)</SectionHeading>
      <p className="text-xs text-slate-400">검색 결과가 없다면 Asset Library에서 캐릭터를 먼저 등록해 주세요.</p>
      {error && (
        <p role="alert" data-testid="cast-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {cast === null && !error && <Spinner label="불러오는 중..." />}
      {cast && cast.length === 0 && <p className="text-sm text-slate-400">선택된 캐릭터가 없습니다.</p>}
      {cast && cast.length > 0 && (
        <ul aria-label="선택된 캐릭터 목록" className="space-y-2">
          {cast.map((member) => (
            <li key={member.assetId} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <span className="text-sm font-medium text-slate-200">{member.assetId}</span>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                배역
                <input
                  className={inlineInput}
                  value={member.castRole}
                  disabled={saving}
                  onChange={(event) => updateMember(member.assetId, "castRole", event.target.value)}
                  onBlur={() => saveMember(member.assetId)}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                이야기 속 역할
                <input
                  className={inlineInput}
                  value={member.storyRole}
                  disabled={saving}
                  onChange={(event) => updateMember(member.assetId, "storyRole", event.target.value)}
                  onBlur={() => saveMember(member.assetId)}
                />
              </label>
              <button type="button" className={smallRemoveButton} disabled={saving} onClick={() => removeMember(member.assetId)}>
                제거
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={search} aria-label="캐릭터 Asset 검색" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          캐릭터 검색
          <input className={inlineInput} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit" className={smallOutlineButton} disabled={searchLoading}>
          검색
        </button>
      </form>
      {searchError && (
        <p role="alert" data-testid="cast-search-error" data-error-code={searchError.code} className="text-sm text-rose-400">
          {searchError.message}
        </p>
      )}
      {results && (
        <ul aria-label="캐릭터 검색 결과" className="space-y-1">
          {results.map((asset) => (
            <li key={asset.assetId} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
              <span className="text-sm text-slate-200">{asset.displayName}</span>
              <button
                type="button"
                className={smallAddButton}
                disabled={saving || cast === null || cast.some((member) => member.assetId === asset.assetId)}
                onClick={() => addMember(asset)}
              >
                추가
              </button>
            </li>
          ))}
        </ul>
      )}
      {results && results.length === 0 && !searchLoading && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}
    </section>
  );
}

/**
 * Wizard-time link to another approved short project's final scene (that project's own last scene, not a fixed
 * Scene 6 — see docs/02_MIGRATION_PLAN.md's scene-count generalization) as this project's Story/Scene 1 continuity
 * source (Python's `lore_context.previous_scene_link`, opt-in only). Candidates are computed and re-validated
 * server-side on every save — this screen only ever sends a projectId, never the derived story text.
 */
function ContinuityEditor({ projectId }: { projectId: string }) {
  const [link, setLink] = useState<ShortProjectContinuityOption | null | undefined>(undefined);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [options, setOptions] = useState<ShortProjectContinuityOption[] | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProjectContinuity(projectId).then((response) => { if (!cancelled) setLink(response.link); })
      .catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function loadOptions(): Promise<void> {
    setOptionsLoading(true); setOptionsError(null);
    try {
      const response = await listProjectContinuityOptions(projectId);
      setOptions(response.options);
    } catch (caught) { setOptionsError(toDisplayError(caught)); }
    finally { setOptionsLoading(false); }
  }

  async function applyLink(sourceProjectId: string | null): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const response = await setProjectContinuity(projectId, { projectId: sourceProjectId });
      setLink(response.link);
      setOptions(null);
    } catch (caught) { setError(toDisplayError(caught)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return (
    <section aria-label="이전 장면 연결" className={cardSection}>
      <SectionHeading>이전 장면 연결</SectionHeading>
      {error && (
        <p role="alert" data-testid="continuity-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {link === undefined && !error && <Spinner label="불러오는 중..." />}
      {link !== undefined && (
        link ? (
          <p className="text-sm text-slate-300">
            {link.label} 연결됨. Story AI에는 마지막 상황, Image AI에는 마지막 장면을 Scene 1 연속성 Reference로 전달합니다.
          </p>
        ) : (
          <p className="text-sm text-slate-400">연결 안 함. 독립적인 새 이야기와 장면으로 시작합니다.</p>
        )
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={outlineButton} disabled={saving} onClick={() => void loadOptions()}>
          이전 프로젝트 선택
        </button>
        {link && (
          <button type="button" className={dangerOutlineButton} disabled={saving} onClick={() => void applyLink(null)}>
            연결 해제
          </button>
        )}
      </div>
      {optionsError && (
        <p role="alert" data-testid="continuity-options-error" data-error-code={optionsError.code} className="text-sm text-rose-400">
          {optionsError.message}
        </p>
      )}
      {options && options.length === 0 && !optionsLoading && (
        <p className="text-sm text-slate-400">연결 가능한 이미지 승인 완료 단기 프로젝트가 없습니다.</p>
      )}
      {options && options.length > 0 && (
        <ul aria-label="이전 프로젝트 선택 목록" className="space-y-1">
          {options.map((option) => (
            <li key={option.projectId} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
              <span className="text-sm text-slate-200">{option.label}</span>
              <button type="button" className={smallAddButton} disabled={saving} onClick={() => void applyLink(option.projectId)}>
                선택
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ATMOSPHERE_ASSET_TYPES: AssetType[] = ["style", "general_reference", "background"];
const SCENE_REFERENCE_ASSET_TYPES: AssetType[] = ["background", "object", "style", "general_reference"];

/**
 * Wizard-time overall mood/color/lighting Assets and per-scene background/object/style/general reference Assets
 * with a required usage purpose (Python's `lore_context.atmosphere_asset_ids`/`scene_reference_assets`). Both
 * lists save together through one endpoint because the backend enforces mutual exclusion between them.
 */
function AssetReferenceEditor({ projectId }: { projectId: string }) {
  const [atmosphereAssetIds, setAtmosphereAssetIds] = useState<string[] | null>(null);
  const [sceneReferenceAssets, setSceneReferenceAssets] = useState<ShortProjectSceneReferenceAsset[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [atmosphereQuery, setAtmosphereQuery] = useState("");
  const [atmosphereResults, setAtmosphereResults] = useState<Asset[] | null>(null);
  const [atmosphereSearchError, setAtmosphereSearchError] = useState<{ code: string; message: string } | null>(null);

  const [sceneQuery, setSceneQuery] = useState("");
  const [sceneResults, setSceneResults] = useState<Asset[] | null>(null);
  const [sceneSearchError, setSceneSearchError] = useState<{ code: string; message: string } | null>(null);
  const [scenePurposeDraft, setScenePurposeDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    getProjectAssetReferences(projectId).then((response) => {
      if (cancelled) return;
      setAtmosphereAssetIds(response.atmosphereAssetIds);
      setSceneReferenceAssets(response.sceneReferenceAssets);
    }).catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function search(query: string, types: AssetType[], setResults: (assets: Asset[]) => void, setSearchError: (error: { code: string; message: string } | null) => void): Promise<void> {
    setSearchError(null);
    try {
      const response = await listAssets({ query: query || undefined });
      setResults(response.assets.filter((asset) => !asset.isFolder && types.includes(asset.assetType)));
    } catch (caught) { setSearchError(toAssetDisplayError(caught)); }
  }

  async function persist(nextAtmosphere: string[], nextSceneReferences: ShortProjectSceneReferenceAsset[]): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const response = await updateProjectAssetReferences(projectId, { atmosphereAssetIds: nextAtmosphere, sceneReferenceAssets: nextSceneReferences });
      setAtmosphereAssetIds(response.atmosphereAssetIds);
      setSceneReferenceAssets(response.sceneReferenceAssets);
    } catch (caught) { setError(toDisplayError(caught)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function addAtmosphere(asset: Asset): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets || atmosphereAssetIds.includes(asset.assetId)) return;
    void persist([...atmosphereAssetIds, asset.assetId], sceneReferenceAssets);
  }
  function removeAtmosphere(assetId: string): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    void persist(atmosphereAssetIds.filter((id) => id !== assetId), sceneReferenceAssets);
  }
  function addSceneReference(asset: Asset): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    const purpose = (scenePurposeDraft[asset.assetId] ?? "").trim();
    if (!purpose || sceneReferenceAssets.some((item) => item.assetId === asset.assetId)) return;
    void persist(atmosphereAssetIds, [...sceneReferenceAssets, { assetId: asset.assetId, purpose }]);
  }
  function removeSceneReference(assetId: string): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    void persist(atmosphereAssetIds, sceneReferenceAssets.filter((item) => item.assetId !== assetId));
  }
  function updateSceneReferencePurpose(assetId: string, purpose: string): void {
    if (!sceneReferenceAssets) return;
    setSceneReferenceAssets(sceneReferenceAssets.map((item) => item.assetId === assetId ? { ...item, purpose } : item));
  }
  function saveSceneReferencePurpose(assetId: string): void {
    if (!atmosphereAssetIds || !sceneReferenceAssets) return;
    const item = sceneReferenceAssets.find((entry) => entry.assetId === assetId);
    if (!item || !item.purpose.trim()) return;
    void persist(atmosphereAssetIds, sceneReferenceAssets);
  }

  const selectedIds = new Set([...(atmosphereAssetIds ?? []), ...(sceneReferenceAssets ?? []).map((item) => item.assetId)]);

  return (
    <section aria-label="분위기·장면 참고 Asset" className={cardSection}>
      <SectionHeading>전체 분위기 및 장면 참고 Asset</SectionHeading>
      <p className="text-xs text-slate-400">검색 결과가 없다면 Asset Library에서 배경·소품·스타일 이미지를 먼저 등록해 주세요.</p>
      {error && (
        <p role="alert" data-testid="asset-reference-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {atmosphereAssetIds === null && !error && <Spinner label="불러오는 중..." />}

      {atmosphereAssetIds && (
        <div aria-label="전체 분위기 Asset" className="space-y-2 rounded-xl border border-white/5 bg-slate-950/30 p-3.5">
          <h4 className="text-sm font-medium text-slate-300">전체 분위기 Asset</h4>
          {atmosphereAssetIds.length === 0 && <p className="text-sm text-slate-400">선택된 분위기 Asset이 없습니다.</p>}
          {atmosphereAssetIds.length > 0 && (
            <ul aria-label="선택된 분위기 Asset 목록" className="space-y-1">
              {atmosphereAssetIds.map((assetId) => (
                <li key={assetId} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2.5">
                  <span className="text-sm text-slate-200">{assetId}</span>
                  <button type="button" className={smallRemoveButton} disabled={saving} onClick={() => removeAtmosphere(assetId)}>
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => { event.preventDefault(); void search(atmosphereQuery, ATMOSPHERE_ASSET_TYPES, setAtmosphereResults, setAtmosphereSearchError); }}
            aria-label="분위기 Asset 검색"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              분위기 Asset 검색
              <input className={inlineInput} value={atmosphereQuery} onChange={(event) => setAtmosphereQuery(event.target.value)} />
            </label>
            <button type="submit" className={smallOutlineButton}>
              검색
            </button>
          </form>
          {atmosphereSearchError && (
            <p role="alert" data-testid="atmosphere-search-error" data-error-code={atmosphereSearchError.code} className="text-sm text-rose-400">
              {atmosphereSearchError.message}
            </p>
          )}
          {atmosphereResults && (
            <ul aria-label="분위기 Asset 검색 결과" className="space-y-1">
              {atmosphereResults.map((asset) => (
                <li key={asset.assetId} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2.5">
                  <span className="text-sm text-slate-200">{asset.displayName}</span>
                  <button type="button" className={smallAddButton} disabled={saving || selectedIds.has(asset.assetId)} onClick={() => addAtmosphere(asset)}>
                    추가
                  </button>
                </li>
              ))}
            </ul>
          )}
          {atmosphereResults && atmosphereResults.length === 0 && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}
        </div>
      )}

      {sceneReferenceAssets && (
        <div aria-label="장면 참고 Asset" className="space-y-2 rounded-xl border border-white/5 bg-slate-950/30 p-3.5">
          <h4 className="text-sm font-medium text-slate-300">장면 참고 Asset</h4>
          {sceneReferenceAssets.length === 0 && <p className="text-sm text-slate-400">선택된 장면 참고 Asset이 없습니다.</p>}
          {sceneReferenceAssets.length > 0 && (
            <ul aria-label="선택된 장면 참고 Asset 목록" className="space-y-2">
              {sceneReferenceAssets.map((item) => (
                <li key={item.assetId} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-900/60 p-3">
                  <span className="text-sm font-medium text-slate-200">{item.assetId}</span>
                  <label className="flex items-center gap-1.5 text-xs text-slate-400">
                    사용 목적
                    <input
                      className={inlineInput}
                      value={item.purpose}
                      disabled={saving}
                      onChange={(event) => updateSceneReferencePurpose(item.assetId, event.target.value)}
                      onBlur={() => saveSceneReferencePurpose(item.assetId)}
                    />
                  </label>
                  <button type="button" className={smallRemoveButton} disabled={saving} onClick={() => removeSceneReference(item.assetId)}>
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => { event.preventDefault(); void search(sceneQuery, SCENE_REFERENCE_ASSET_TYPES, setSceneResults, setSceneSearchError); }}
            aria-label="장면 참고 Asset 검색"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              장면 참고 Asset 검색
              <input className={inlineInput} value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} />
            </label>
            <button type="submit" className={smallOutlineButton}>
              검색
            </button>
          </form>
          {sceneSearchError && (
            <p role="alert" data-testid="scene-reference-search-error" data-error-code={sceneSearchError.code} className="text-sm text-rose-400">
              {sceneSearchError.message}
            </p>
          )}
          {sceneResults && (
            <ul aria-label="장면 참고 Asset 검색 결과" className="space-y-1">
              {sceneResults.map((asset) => (
                <li key={asset.assetId} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-900/60 p-3">
                  <span className="text-sm text-slate-200">{asset.displayName}</span>
                  <label className="flex items-center gap-1.5 text-xs text-slate-400">
                    사용 목적
                    <input
                      className={inlineInput}
                      value={scenePurposeDraft[asset.assetId] ?? ""}
                      onChange={(event) => setScenePurposeDraft({ ...scenePurposeDraft, [asset.assetId]: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className={smallAddButton}
                    disabled={saving || selectedIds.has(asset.assetId) || !(scenePurposeDraft[asset.assetId] ?? "").trim()}
                    onClick={() => addSceneReference(asset)}
                  >
                    추가
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sceneResults && sceneResults.length === 0 && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}
        </div>
      )}
    </section>
  );
}

export function ShortProjectSettingsScreen({ projectId, onBack, justCreated = false }: Props) {
  const [state, setState] = useState<State>({ settings: null, loading: true, error: null });
  const saving = useRef(false);
  const [characterOptions, setCharacterOptions] = useState<Asset[] | null>(null);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [characterOptionsLoading, setCharacterOptionsLoading] = useState(false);
  const [characterOptionsError, setCharacterOptionsError] = useState<{ code: string; message: string } | null>(null);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false);
  const [promptPreviewError, setPromptPreviewError] = useState<{ code: string; message: string } | null>(null);
  const promptPreviewRequest = useRef(0);
  const [justSaved, setJustSaved] = useState(false);
  const justSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!promptPreviewOpen || !state.settings) return;
    const settings = state.settings;
    if (!settings.projectName.trim() || !settings.topic.trim()) {
      setPromptPreview(null);
      setPromptPreviewError(null);
      setPromptPreviewLoading(false);
      return;
    }
    const requestId = ++promptPreviewRequest.current;
    setPromptPreviewLoading(true);
    // durationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an
    // unsupported field if sent, so it is left out of the draft-preview request body here.
    const { durationSeconds: _draftDurationSeconds, ...settingsInput } = settings;
    const timer = setTimeout(() => {
      void createStoryPromptDraftPreview(projectId, settingsInput)
        .then((response) => {
          if (requestId !== promptPreviewRequest.current) return;
          setPromptPreview(response.prompt);
          setPromptPreviewError(null);
        })
        .catch((caught: unknown) => {
          if (requestId !== promptPreviewRequest.current) return;
          setPromptPreviewError(toStoryDisplayError(caught));
        })
        .finally(() => {
          if (requestId === promptPreviewRequest.current) setPromptPreviewLoading(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [promptPreviewOpen, state.settings, projectId]);

  useEffect(() => {
    let cancelled = false;
    getProjectSettings(projectId).then(({ settings }) => {
      if (!cancelled) setState({ settings, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ settings: null, loading: false, error: toDisplayError(error) });
    });
    return () => { cancelled = true; };
  }, [projectId]);

  function setField<Key extends keyof ShortProjectSettings>(key: Key, value: ShortProjectSettings[Key]): void {
    setState((old) => old.settings ? { ...old, settings: { ...old.settings, [key]: value }, error: null } : old);
    setJustSaved(false);
  }

  async function openCharacterPicker(): Promise<void> {
    setCharacterPickerOpen((open) => !open);
    if (characterOptions !== null) return;
    setCharacterOptionsLoading(true);
    setCharacterOptionsError(null);
    try {
      const response = await listAssets({ assetType: "character" });
      setCharacterOptions(response.assets);
    } catch (caught) {
      setCharacterOptionsError(toAssetDisplayError(caught));
    } finally {
      setCharacterOptionsLoading(false);
    }
  }

  function pickCharacter(asset: Asset): void {
    setField("character", asset.displayName);
    setCharacterPickerOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.settings || saving.current) return;
    // durationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an
    // unsupported field if sent, so it is left out of the save request body here.
    const { durationSeconds: _formDurationSeconds, ...settingsInput } = state.settings;
    const settings = { ...settingsInput, projectName: state.settings.projectName.trim(), topic: state.settings.topic.trim() };
    if (!settings.projectName || !settings.topic) {
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "프로젝트 이름과 영상 주제는 필수입니다." } }));
      return;
    }
    saving.current = true;
    setState((old) => ({ ...old, loading: true, error: null }));
    try {
      const response = await updateProjectSettings(projectId, { settings });
      setState({ settings: response.settings, loading: false, error: null });
      setJustSaved(true);
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current);
      justSavedTimer.current = setTimeout(() => setJustSaved(false), 4000);
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: toDisplayError(error) }));
    } finally { saving.current = false; }
  }

  if (state.loading && !state.settings) return <Spinner label="불러오는 중…" className="mt-8" />;
  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        {justCreated ? "프로젝트로 이동" : "프로젝트로 돌아가기"}
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        프로젝트 설정
      </h2>
      {justCreated && (
        <p className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200" data-testid="just-created-notice">
          프로젝트가 생성되었습니다. 대본을 생성하기 전에 아래에서 장르·분위기와 등장 캐릭터, 참고 이미지, 이전 장면 연결을
          설정해 주세요 — 전부 선택 사항이며 나중에 다시 와서 바꿀 수도 있습니다.
        </p>
      )}
      {state.error && !state.settings && (
        <p className="text-sm text-rose-400" role="alert" data-error-code={state.error.code}>
          {state.error.message}
        </p>
      )}
      {state.settings && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <form className="grid gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 md:grid-cols-2" onSubmit={submit} noValidate>
          <Field label="프로젝트 이름" value={state.settings.projectName} onChange={(value) => setField("projectName", value)} />
          <Field label="영상 주제" value={state.settings.topic} onChange={(value) => setField("topic", value)} />
          <Field label="장르" value={state.settings.genre} onChange={(value) => setField("genre", value)} />
          <Field label="분위기" value={state.settings.mood} onChange={(value) => setField("mood", value)} />
          <Field label="대표 캐릭터" value={state.settings.character} onChange={(value) => setField("character", value)} />
          <div className="text-sm text-slate-300 md:col-span-2">
            <button type="button" className={smallOutlineButton} onClick={() => void openCharacterPicker()}>
              {characterPickerOpen ? "이미지에서 선택 닫기" : "이미지에서 캐릭터 선택"}
            </button>
            {characterPickerOpen && (
              <div className="mt-2 space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                {characterOptionsLoading && <Spinner label="캐릭터 이미지를 불러오는 중..." />}
                {characterOptionsError && (
                  <p role="alert" data-testid="character-picker-error" data-error-code={characterOptionsError.code} className="text-sm text-rose-400">
                    {characterOptionsError.message}
                  </p>
                )}
                {characterOptions && characterOptions.length === 0 && !characterOptionsLoading && (
                  <p className="text-sm text-slate-400">Asset Library에 등록된 캐릭터가 없습니다. 먼저 캐릭터 이미지를 등록해 주세요.</p>
                )}
                {characterOptions && characterOptions.length > 0 && (
                  <ul aria-label="캐릭터 이미지 선택" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {characterOptions.map((asset) => (
                      <li key={asset.assetId}>
                        <button
                          type="button"
                          className="w-full rounded-lg border border-white/10 bg-slate-900/70 p-1.5 text-left hover:border-violet-400/40"
                          onClick={() => pickCharacter(asset)}
                        >
                          {asset.imageAvailable && asset.contentUrl ? (
                            <img src={asset.contentUrl} alt="" className="h-16 w-full rounded object-cover" />
                          ) : (
                            <span className="flex h-16 w-full items-center justify-center rounded bg-slate-950/40 text-xs text-slate-500">이미지 없음</span>
                          )}
                          <span className="mt-1 block truncate text-xs text-slate-200">{asset.displayName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <label className="block text-sm text-slate-300">
            장면 수
            <input
              type="number"
              min={MIN_SCENE_COUNT}
              max={MAX_SCENE_COUNT}
              className={fieldClassName}
              value={state.settings.sceneCount}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isInteger(parsed)) return;
                const sceneCount = Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, parsed));
                setField("sceneCount", sceneCount);
                setField("durationSeconds", sceneCount * state.settings!.clipDurationSeconds);
              }}
            />
          </label>
          <label className="block text-sm text-slate-300">
            클립 길이(초)
            <select
              className={fieldClassName}
              value={state.settings.clipDurationSeconds}
              onChange={(event) => {
                const clipDurationSeconds = Number(event.target.value);
                setField("clipDurationSeconds", clipDurationSeconds);
                setField("durationSeconds", state.settings!.sceneCount * clipDurationSeconds);
              }}
            >
              {RUNWAY_CLIP_DURATIONS.map((duration) => (
                <option key={duration} value={duration}>{duration}초</option>
              ))}
            </select>
          </label>
          <Field label="전체 줄거리" value={state.settings.fullStory} onChange={(value) => setField("fullStory", value)} multiline />
          <Field label="세계관" value={state.settings.lore} onChange={(value) => setField("lore", value)} multiline />
          <Field label="시각 스타일" value={state.settings.styleNotes.visualStyle ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, visualStyle: value })} />
          <Field label="색감" value={state.settings.styleNotes.color ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, color: value })} />
          <Field label="조명" value={state.settings.styleNotes.lighting ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, lighting: value })} />
          <Field label="카메라 느낌" value={state.settings.styleNotes.camera ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, camera: value })} />
          <Field label="대사 스타일" value={state.settings.styleNotes.dialogue ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, dialogue: value })} />
          <Field label="피할 요소" value={state.settings.styleNotes.avoid ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, avoid: value })} />
          <Field label="화면 비율" value={state.settings.styleNotes.aspect ?? ""} onChange={(value) => setField("styleNotes", { ...state.settings!.styleNotes, aspect: value })} />
          <Field label="추가 지시사항" value={state.settings.additionalNotes} onChange={(value) => setField("additionalNotes", value)} multiline />
          <p className="text-sm text-slate-400 md:col-span-2">
            예상 총 영상 길이: {state.settings.sceneCount * state.settings.clipDurationSeconds}초 ({state.settings.sceneCount}장면 × {state.settings.clipDurationSeconds}초)
          </p>
          {state.error && (
            <p className="text-sm text-rose-400 md:col-span-2" role="alert" data-error-code={state.error.code}>
              {state.error.message}
            </p>
          )}
          {justSaved && !state.error && (
            <p
              role="status"
              data-testid="settings-saved-notice"
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-2 text-sm text-emerald-300 md:col-span-2"
            >
              설정이 저장되었습니다.
            </p>
          )}
          <button type="submit" disabled={state.loading} className={`${primaryButton} md:col-span-2`}>
            {state.loading ? "저장 중…" : "설정 저장"}
          </button>
        </form>
        <aside aria-label="대본 프롬프트 실시간 미리보기" className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-4 lg:sticky lg:top-4">
          <button type="button" className={smallOutlineButton} onClick={() => setPromptPreviewOpen((open) => !open)}>
            {promptPreviewOpen ? "프롬프트 미리보기 닫기" : "프롬프트 미리보기 보기"}
          </button>
          {promptPreviewOpen && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">입력을 멈추면 잠시 후 실제 대본 AI에 보낼 프롬프트가 여기에 표시됩니다. 저장하지 않아도 됩니다.</p>
              {promptPreviewLoading && <Spinner label="미리보기 갱신 중..." />}
              {!promptPreviewLoading && promptPreviewError && (
                <p role="alert" data-testid="story-prompt-draft-preview-error" data-error-code={promptPreviewError.code} className="text-xs text-rose-400">
                  {promptPreviewError.message}
                </p>
              )}
              {!promptPreviewLoading && !promptPreviewError && promptPreview && (
                <pre data-testid="story-prompt-draft-preview" className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-slate-950/60 p-3 text-xs text-slate-300">
                  {promptPreview}
                </pre>
              )}
              {!promptPreviewLoading && !promptPreviewError && !promptPreview && (
                <p className="text-xs text-slate-500">프로젝트 이름과 영상 주제를 채우면 미리보기가 표시됩니다.</p>
              )}
            </div>
          )}
        </aside>
        </div>
      )}
      {state.settings && <CastEditor projectId={projectId} />}
      {state.settings && <AssetReferenceEditor projectId={projectId} />}
      {state.settings && <ContinuityEditor projectId={projectId} />}
      {state.settings && justCreated && (
        <div className="flex justify-end">
          <button type="button" data-testid="finish-setup-button" className={primaryButton} onClick={onBack}>
            설정 완료 · 계속 진행하기
          </button>
        </div>
      )}
    </section>
  );
}
