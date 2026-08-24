import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Asset, AssetType, ShortProjectCastMember, ShortProjectContinuityOption, ShortProjectSceneReferenceAsset, ShortProjectSettings } from "@ai-animation-studio/shared";

import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import {
  getProjectAssetReferences, getProjectCast, getProjectContinuity, getProjectSettings, listProjectContinuityOptions, setProjectContinuity, toDisplayError,
  updateProjectAssetReferences, updateProjectCast, updateProjectSettings,
} from "../api/projectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; onBack: () => void; justCreated?: boolean; }
type State = { settings: ShortProjectSettings | null; loading: boolean; error: { code: string; message: string } | null };

const EMPTY_SETTINGS: ShortProjectSettings = {
  projectName: "", topic: "", genre: "미스터리", mood: "시네마틱", character: "", lore: "", fullStory: "",
  durationSeconds: 30, sceneCount: 6, additionalNotes: "", styleNotes: { aspect: "16:9" },
};

function Field({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const classes = "mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-slate-100";
  return <label className="block text-sm text-slate-300">{label}{multiline
    ? <textarea className={classes} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
    : <input className={classes} value={value} onChange={(event) => onChange(event.target.value)} />}
  </label>;
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

  return <section aria-label="등장 캐릭터" className="space-y-3 rounded border border-white/10 p-4 md:col-span-2">
    <h3 className="font-semibold">등장 캐릭터(Cast)</h3>
    <p className="text-xs text-slate-400">검색 결과가 없다면 Asset Library에서 캐릭터를 먼저 등록해 주세요.</p>
    {error && <p role="alert" data-testid="cast-error" data-error-code={error.code} className="text-red-300">{error.message}</p>}
    {cast === null && !error && <Spinner label="불러오는 중..." />}
    {cast && cast.length === 0 && <p>선택된 캐릭터가 없습니다.</p>}
    {cast && cast.length > 0 && <ul aria-label="선택된 캐릭터 목록" className="space-y-2">
      {cast.map((member) => <li key={member.assetId} className="flex flex-wrap items-center gap-2">
        <span>{member.assetId}</span>
        <label>배역 <input value={member.castRole} disabled={saving} onChange={(event) => updateMember(member.assetId, "castRole", event.target.value)} onBlur={() => saveMember(member.assetId)} /></label>
        <label>이야기 속 역할 <input value={member.storyRole} disabled={saving} onChange={(event) => updateMember(member.assetId, "storyRole", event.target.value)} onBlur={() => saveMember(member.assetId)} /></label>
        <button type="button" disabled={saving} onClick={() => removeMember(member.assetId)}>제거</button>
      </li>)}
    </ul>}
    <form onSubmit={search} aria-label="캐릭터 Asset 검색" className="flex flex-wrap items-end gap-2">
      <label>캐릭터 검색 <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="submit" disabled={searchLoading}>검색</button>
    </form>
    {searchError && <p role="alert" data-testid="cast-search-error" data-error-code={searchError.code} className="text-red-300">{searchError.message}</p>}
    {results && <ul aria-label="캐릭터 검색 결과" className="space-y-1">
      {results.map((asset) => <li key={asset.assetId} className="flex items-center gap-2">
        <span>{asset.displayName}</span>
        <button type="button" disabled={saving || cast === null || cast.some((member) => member.assetId === asset.assetId)} onClick={() => addMember(asset)}>추가</button>
      </li>)}
    </ul>}
    {results && results.length === 0 && !searchLoading && <p>검색 결과가 없습니다.</p>}
  </section>;
}

/**
 * Wizard-time link to another approved short project's Scene 6 as this project's Story/Scene 1 continuity source
 * (Python's `lore_context.previous_scene_link`, opt-in only). Candidates are computed and re-validated
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

  return <section aria-label="이전 장면 연결" className="space-y-3 rounded border border-white/10 p-4 md:col-span-2">
    <h3 className="font-semibold">이전 장면 연결</h3>
    {error && <p role="alert" data-testid="continuity-error" data-error-code={error.code} className="text-red-300">{error.message}</p>}
    {link === undefined && !error && <Spinner label="불러오는 중..." />}
    {link !== undefined && (link
      ? <p>{link.label} 연결됨. Story AI에는 마지막 상황, Image AI에는 마지막 장면을 Scene 1 연속성 Reference로 전달합니다.</p>
      : <p>연결 안 함. 독립적인 새 이야기와 장면으로 시작합니다.</p>)}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={saving} onClick={() => void loadOptions()}>이전 프로젝트 선택</button>
      {link && <button type="button" disabled={saving} onClick={() => void applyLink(null)}>연결 해제</button>}
    </div>
    {optionsError && <p role="alert" data-testid="continuity-options-error" data-error-code={optionsError.code} className="text-red-300">{optionsError.message}</p>}
    {options && options.length === 0 && !optionsLoading && <p>연결 가능한 이미지 승인 완료 단기 프로젝트가 없습니다.</p>}
    {options && options.length > 0 && <ul aria-label="이전 프로젝트 선택 목록" className="space-y-1">
      {options.map((option) => <li key={option.projectId} className="flex items-center gap-2">
        <span>{option.label}</span>
        <button type="button" disabled={saving} onClick={() => void applyLink(option.projectId)}>선택</button>
      </li>)}
    </ul>}
  </section>;
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

  return <section aria-label="분위기·장면 참고 Asset" className="space-y-3 rounded border border-white/10 p-4 md:col-span-2">
    <h3 className="font-semibold">전체 분위기 및 장면 참고 Asset</h3>
    <p className="text-xs text-slate-400">검색 결과가 없다면 Asset Library에서 배경·소품·스타일 이미지를 먼저 등록해 주세요.</p>
    {error && <p role="alert" data-testid="asset-reference-error" data-error-code={error.code} className="text-red-300">{error.message}</p>}
    {atmosphereAssetIds === null && !error && <Spinner label="불러오는 중..." />}

    {atmosphereAssetIds && <div aria-label="전체 분위기 Asset" className="space-y-2">
      <h4 className="text-sm font-medium text-slate-300">전체 분위기 Asset</h4>
      {atmosphereAssetIds.length === 0 && <p>선택된 분위기 Asset이 없습니다.</p>}
      {atmosphereAssetIds.length > 0 && <ul aria-label="선택된 분위기 Asset 목록" className="space-y-1">
        {atmosphereAssetIds.map((assetId) => <li key={assetId} className="flex items-center gap-2">
          <span>{assetId}</span>
          <button type="button" disabled={saving} onClick={() => removeAtmosphere(assetId)}>제거</button>
        </li>)}
      </ul>}
      <form onSubmit={(event) => { event.preventDefault(); void search(atmosphereQuery, ATMOSPHERE_ASSET_TYPES, setAtmosphereResults, setAtmosphereSearchError); }} aria-label="분위기 Asset 검색" className="flex flex-wrap items-end gap-2">
        <label>분위기 Asset 검색 <input value={atmosphereQuery} onChange={(event) => setAtmosphereQuery(event.target.value)} /></label>
        <button type="submit">검색</button>
      </form>
      {atmosphereSearchError && <p role="alert" data-testid="atmosphere-search-error" data-error-code={atmosphereSearchError.code} className="text-red-300">{atmosphereSearchError.message}</p>}
      {atmosphereResults && <ul aria-label="분위기 Asset 검색 결과" className="space-y-1">
        {atmosphereResults.map((asset) => <li key={asset.assetId} className="flex items-center gap-2">
          <span>{asset.displayName}</span>
          <button type="button" disabled={saving || selectedIds.has(asset.assetId)} onClick={() => addAtmosphere(asset)}>추가</button>
        </li>)}
      </ul>}
      {atmosphereResults && atmosphereResults.length === 0 && <p>검색 결과가 없습니다.</p>}
    </div>}

    {sceneReferenceAssets && <div aria-label="장면 참고 Asset" className="space-y-2">
      <h4 className="text-sm font-medium text-slate-300">장면 참고 Asset</h4>
      {sceneReferenceAssets.length === 0 && <p>선택된 장면 참고 Asset이 없습니다.</p>}
      {sceneReferenceAssets.length > 0 && <ul aria-label="선택된 장면 참고 Asset 목록" className="space-y-2">
        {sceneReferenceAssets.map((item) => <li key={item.assetId} className="flex flex-wrap items-center gap-2">
          <span>{item.assetId}</span>
          <label>사용 목적 <input value={item.purpose} disabled={saving} onChange={(event) => updateSceneReferencePurpose(item.assetId, event.target.value)} onBlur={() => saveSceneReferencePurpose(item.assetId)} /></label>
          <button type="button" disabled={saving} onClick={() => removeSceneReference(item.assetId)}>제거</button>
        </li>)}
      </ul>}
      <form onSubmit={(event) => { event.preventDefault(); void search(sceneQuery, SCENE_REFERENCE_ASSET_TYPES, setSceneResults, setSceneSearchError); }} aria-label="장면 참고 Asset 검색" className="flex flex-wrap items-end gap-2">
        <label>장면 참고 Asset 검색 <input value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} /></label>
        <button type="submit">검색</button>
      </form>
      {sceneSearchError && <p role="alert" data-testid="scene-reference-search-error" data-error-code={sceneSearchError.code} className="text-red-300">{sceneSearchError.message}</p>}
      {sceneResults && <ul aria-label="장면 참고 Asset 검색 결과" className="space-y-1">
        {sceneResults.map((asset) => <li key={asset.assetId} className="flex flex-wrap items-center gap-2">
          <span>{asset.displayName}</span>
          <label>사용 목적 <input value={scenePurposeDraft[asset.assetId] ?? ""} onChange={(event) => setScenePurposeDraft({ ...scenePurposeDraft, [asset.assetId]: event.target.value })} /></label>
          <button type="button" disabled={saving || selectedIds.has(asset.assetId) || !(scenePurposeDraft[asset.assetId] ?? "").trim()} onClick={() => addSceneReference(asset)}>추가</button>
        </li>)}
      </ul>}
      {sceneResults && sceneResults.length === 0 && <p>검색 결과가 없습니다.</p>}
    </div>}
  </section>;
}

export function ShortProjectSettingsScreen({ projectId, onBack, justCreated = false }: Props) {
  const [state, setState] = useState<State>({ settings: null, loading: true, error: null });
  const saving = useRef(false);

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
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.settings || saving.current) return;
    const settings = { ...state.settings, projectName: state.settings.projectName.trim(), topic: state.settings.topic.trim() };
    if (!settings.projectName || !settings.topic) {
      setState((old) => ({ ...old, error: { code: "INVALID_REQUEST", message: "프로젝트 이름과 영상 주제는 필수입니다." } }));
      return;
    }
    saving.current = true;
    setState((old) => ({ ...old, loading: true, error: null }));
    try {
      const response = await updateProjectSettings(projectId, { settings });
      setState({ settings: response.settings, loading: false, error: null });
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: toDisplayError(error) }));
    } finally { saving.current = false; }
  }

  if (state.loading && !state.settings) return <Spinner label="불러오는 중…" className="mt-8" />;
  return <section className="mt-8">
    <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
      {justCreated ? "프로젝트로 이동" : "프로젝트로 돌아가기"}
    </button>
    <h2 className="mt-4 text-xl font-semibold">프로젝트 설정</h2>
    {justCreated && (
      <p className="mt-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200" data-testid="just-created-notice">
        프로젝트가 생성되었습니다. 대본을 생성하기 전에 아래에서 장르·분위기와 등장 캐릭터, 참고 이미지, 이전 장면 연결을
        설정해 주세요 — 전부 선택 사항이며 나중에 다시 와서 바꿀 수도 있습니다.
      </p>
    )}
    {state.error && <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>{state.error.message}</p>}
    {state.settings && <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
      <Field label="프로젝트 이름" value={state.settings.projectName} onChange={(value) => setField("projectName", value)} />
      <Field label="영상 주제" value={state.settings.topic} onChange={(value) => setField("topic", value)} />
      <Field label="장르" value={state.settings.genre} onChange={(value) => setField("genre", value)} />
      <Field label="분위기" value={state.settings.mood} onChange={(value) => setField("mood", value)} />
      <Field label="대표 캐릭터" value={state.settings.character} onChange={(value) => setField("character", value)} />
      <Field label="영상 길이(초)" value={String(state.settings.durationSeconds)} onChange={(value) => setField("durationSeconds", Number(value) || 0)} />
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
      <p className="text-sm text-slate-400">장면 수: 정확히 {state.settings.sceneCount}개</p>
      <button type="submit" disabled={state.loading} className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{state.loading ? "저장 중…" : "설정 저장"}</button>
    </form>}
    {state.settings && <CastEditor projectId={projectId} />}
    {state.settings && <AssetReferenceEditor projectId={projectId} />}
    {state.settings && <ContinuityEditor projectId={projectId} />}
    {state.settings && justCreated && (
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          data-testid="finish-setup-button"
          className="rounded-full bg-violet-500 px-5 py-2 text-sm font-semibold text-white"
          onClick={onBack}
        >
          설정 완료 · 계속 진행하기
        </button>
      </div>
    )}
  </section>;
}
