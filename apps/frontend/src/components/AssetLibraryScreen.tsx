import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Asset, AssetType, CreateAssetMetadata, GetAssetResponse, UpdateAssetMetadataRequest } from "@ai-animation-studio/shared";
import { createAsset, deleteAsset, getAsset, listAssets, toAssetDisplayError, updateAsset } from "../api/assetsApi.js";

interface Props { onBack: () => void }
const TYPES: Array<{ value: AssetType; label: string }> = [
  { value: "character", label: "캐릭터" }, { value: "style", label: "스타일" },
  { value: "background", label: "배경" }, { value: "object", label: "오브젝트" },
  { value: "general_reference", label: "일반 참고" },
];
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const IMPORT_VALIDATION_MESSAGE = "이미지 파일과 이름을 모두 입력해 주세요.";

export function AssetLibraryScreen({ onBack }: Props) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [assetType, setAssetType] = useState<AssetType | "">("");
  const [selected, setSelected] = useState<GetAssetResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<{ code: string; message: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importType, setImportType] = useState<AssetType>("general_reference");
  const [importDescription, setImportDescription] = useState("");
  const [importTags, setImportTags] = useState("");
  const [importValidationError, setImportValidationError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [fileInputGeneration, setFileInputGeneration] = useState(0);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const importBusy = useRef(false);
  const editBusy = useRef(false);
  const deleteBusy = useRef(false);

  async function load(nextQuery = query, nextType = assetType) {
    const requestId = ++listRequest.current;
    setLoading(true);
    try {
      const response = await listAssets({ query: nextQuery || undefined, assetType: nextType || undefined });
      if (requestId === listRequest.current) { setAssets(response.assets); setError(null); }
    } catch (caught) {
      if (requestId === listRequest.current) setError(toAssetDisplayError(caught));
    } finally { if (requestId === listRequest.current) setLoading(false); }
  }
  useEffect(() => { void load("", ""); }, []);

  async function open(assetId: string) {
    const requestId = ++detailRequest.current;
    setDetailLoading(true); setDetailError(null);
    try {
      const response = await getAsset(assetId);
      if (requestId !== detailRequest.current) return; // superseded by a newer selection
      setSelected(response);
      setEditName(response.asset.displayName); setEditDescription(response.asset.description); setEditTags(response.asset.tags.join(", "));
    } catch (caught) {
      if (requestId !== detailRequest.current) return; // superseded by a newer selection
      setSelected(null); setDetailError(toAssetDisplayError(caught));
    } finally { if (requestId === detailRequest.current) setDetailLoading(false); }
  }

  async function submitImport(event: FormEvent) {
    event.preventDefault();
    if (importBusy.current) return;
    if (!file || !importName.trim()) { setImportValidationError(IMPORT_VALIDATION_MESSAGE); return; }
    setImportValidationError(null);
    importBusy.current = true; setImportPending(true);
    const listGenerationAtStart = listRequest.current;
    const detailGenerationAtStart = detailRequest.current;
    const metadata: CreateAssetMetadata = { assetType: importType, displayName: importName.trim(), description: importDescription.trim(), tags: splitList(importTags) };
    try {
      const response = await createAsset(file, metadata);
      setFile(null); setImportName(""); setImportDescription(""); setImportTags(""); setError(null);
      setFileInputGeneration((current) => current + 1);
      // A newer explicit search or a newer asset selection already superseded this import's context — don't clobber it.
      if (listRequest.current === listGenerationAtStart) await load();
      if (detailRequest.current === detailGenerationAtStart) await open(response.asset.assetId);
    } catch (caught) { setError(toAssetDisplayError(caught)); }
    finally { importBusy.current = false; setImportPending(false); }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!selected || editBusy.current || !editName.trim()) return;
    const targetId = selected.asset.assetId;
    editBusy.current = true; setEditPending(true);
    const listGenerationAtStart = listRequest.current;
    const metadata: UpdateAssetMetadataRequest = { displayName: editName.trim(), description: editDescription.trim(), tags: splitList(editTags) };
    try {
      const response = await updateAsset(targetId, metadata);
      setSelected((current) => (current && current.asset.assetId === targetId ? { ...current, asset: response.asset } : current));
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setError(toAssetDisplayError(caught)); }
    finally { editBusy.current = false; setEditPending(false); }
  }

  async function remove() {
    if (!selected || deleteBusy.current || selected.usageProjectIds.length > 0) return;
    const targetId = selected.asset.assetId;
    if (!window.confirm(`'${selected.asset.displayName}' 에셋을 라이브러리 목록에서 삭제할까요? 원본 파일은 삭제하지 않습니다.`)) return;
    deleteBusy.current = true; setDeletePending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      await deleteAsset(targetId);
      setSelected((current) => (current && current.asset.assetId === targetId ? null : current));
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setError(toAssetDisplayError(caught)); }
    finally { deleteBusy.current = false; setDeletePending(false); }
  }

  return <section className="mt-8 space-y-6">
    <header className="flex items-center justify-between"><button type="button" onClick={onBack}>프로젝트 목록으로</button><h2 className="text-2xl font-semibold">Asset Library</h2></header>
    {error && <p role="alert" data-error-code={error.code} className="text-red-300">{error.message}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex gap-3">
      <label>검색 <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>유형 <select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType | "")}><option value="">전체</option>{TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button type="submit">검색</button>
    </form>
    {loading && !assets && <p>에셋을 불러오는 중...</p>}
    {assets && assets.length === 0 && !loading && <p>등록된 에셋이 없습니다.</p>}
    {assets && <ul aria-label="에셋 목록" className="grid gap-3 sm:grid-cols-2">{assets.map((asset) => <li key={asset.assetId}><button type="button" onClick={() => void open(asset.assetId)} className="w-full rounded border border-white/10 p-3 text-left">
      {asset.imageAvailable && asset.contentUrl ? <img src={asset.contentUrl} alt="" className="h-24 w-full object-cover" /> : <span>이미지 없음</span>}
      <strong>{asset.displayName}</strong><span> · {asset.assetType}</span><p>{asset.description}</p>
    </button></li>)}</ul>}

    <form onSubmit={submitImport} aria-label="에셋 가져오기" className="space-y-2 rounded border border-white/10 p-4">
      <h3 className="font-semibold">이미지 가져오기</h3>
      {importValidationError && <p role="alert" data-testid="import-validation-error">{importValidationError}</p>}
      <label>이미지 파일 <input key={fileInputGeneration} type="file" accept="image/*" disabled={importPending} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setImportValidationError(null); }} /></label>
      <label>이름 <input value={importName} disabled={importPending} onChange={(event) => { setImportName(event.target.value); setImportValidationError(null); }} /></label>
      <label>유형 <select value={importType} disabled={importPending} onChange={(event) => setImportType(event.target.value as AssetType)}>{TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>설명 <input value={importDescription} disabled={importPending} onChange={(event) => setImportDescription(event.target.value)} /></label>
      <label>태그(쉼표 구분) <input value={importTags} disabled={importPending} onChange={(event) => setImportTags(event.target.value)} /></label>
      <button type="submit" disabled={importPending}>가져오기</button>
    </form>

    {detailLoading && <p>선택한 에셋 정보를 불러오는 중...</p>}
    {detailError && <p role="alert" data-testid="asset-detail-error" data-error-code={detailError.code} className="text-red-300">{detailError.message}</p>}
    {selected && <section aria-label="에셋 상세" className="space-y-3 rounded border border-violet-400/30 p-4">
      <h3 className="text-xl font-semibold">{selected.asset.displayName}</h3>
      {selected.asset.imageAvailable && selected.asset.contentUrl && <img src={selected.asset.contentUrl} alt={`${selected.asset.displayName} 미리보기`} className="max-h-64 object-contain" />}
      <p>소유권: {selected.ownership}</p><p>사용 프로젝트: {selected.usageProjectIds.length ? selected.usageProjectIds.join(", ") : "없음"}</p>
      <form onSubmit={submitEdit} aria-label="에셋 정보 편집" className="space-y-2">
        <label>이름 <input value={editName} required disabled={editPending} onChange={(event) => setEditName(event.target.value)} /></label>
        <label>설명 <input value={editDescription} disabled={editPending} onChange={(event) => setEditDescription(event.target.value)} /></label>
        <label>태그(쉼표 구분) <input value={editTags} disabled={editPending} onChange={(event) => setEditTags(event.target.value)} /></label>
        <button type="submit" disabled={editPending}>변경 저장</button>
      </form>
      <button type="button" onClick={() => void remove()} disabled={selected.usageProjectIds.length > 0 || deletePending}>목록에서 삭제</button>
      {selected.usageProjectIds.length > 0 && <p>사용 중인 에셋은 삭제할 수 없습니다.</p>}
    </section>}
  </section>;
}
