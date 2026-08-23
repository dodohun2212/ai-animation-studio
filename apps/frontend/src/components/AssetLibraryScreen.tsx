import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Asset, AssetFileAuditEntry, AssetType, CreateAssetMetadata, GetAssetResponse, RunLegacyReferenceMigrationResponse, UpdateAssetMetadataRequest } from "@ai-animation-studio/shared";
import { addAssetVersion, createAsset, deleteAsset, deleteAssetFolder, deleteAssetOwnedFile, getAsset, listAssetFileAudit, listAssets, relinkAsset, runLegacyReferenceMigration, toAssetDisplayError, updateAsset, updateCharacterFolderReferenceSet } from "../api/assetsApi.js";

interface Props { onBack: () => void; initialQuery?: string }
const TYPES: Array<{ value: AssetType; label: string }> = [
  { value: "character", label: "캐릭터" }, { value: "style", label: "스타일" },
  { value: "background", label: "배경" }, { value: "object", label: "오브젝트" },
  { value: "general_reference", label: "일반 참고" },
];
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const IMPORT_VALIDATION_MESSAGE = "이미지 파일과 이름을 모두 입력해 주세요.";

export function AssetLibraryScreen({ onBack, initialQuery = "" }: Props) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(initialQuery);
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
  const [referenceSetPending, setReferenceSetPending] = useState(false);
  const [fileInputGeneration, setFileInputGeneration] = useState(0);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNotes, setVersionNotes] = useState("");
  const [versionPending, setVersionPending] = useState(false);
  const [versionFileGeneration, setVersionFileGeneration] = useState(0);
  const [relinkFile, setRelinkFile] = useState<File | null>(null);
  const [relinkPending, setRelinkPending] = useState(false);
  const [relinkFileGeneration, setRelinkFileGeneration] = useState(0);
  const [ownedFileDeletePending, setOwnedFileDeletePending] = useState(false);
  const [audit, setAudit] = useState<AssetFileAuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<{ code: string; message: string } | null>(null);
  const [legacyMigrationPending, setLegacyMigrationPending] = useState(false);
  const [legacyMigrationResult, setLegacyMigrationResult] = useState<RunLegacyReferenceMigrationResponse | null>(null);
  const [legacyMigrationError, setLegacyMigrationError] = useState<{ code: string; message: string } | null>(null);
  const [folderRemoveChildIndexes, setFolderRemoveChildIndexes] = useState(false);
  const [folderDeleteManualFiles, setFolderDeleteManualFiles] = useState(false);
  const [folderDeletePending, setFolderDeletePending] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const auditRequest = useRef(0);
  const importBusy = useRef(false);
  const editBusy = useRef(false);
  const deleteBusy = useRef(false);
  const referenceSetBusy = useRef(false);
  const versionBusy = useRef(false);
  const relinkBusy = useRef(false);
  const legacyMigrationBusy = useRef(false);
  const ownedFileDeleteBusy = useRef(false);
  const folderDeleteBusy = useRef(false);

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
  useEffect(() => { void load(initialQuery, ""); }, []);

  async function open(assetId: string) {
    const requestId = ++detailRequest.current;
    setDetailLoading(true); setDetailError(null);
    try {
      const response = await getAsset(assetId);
      if (requestId !== detailRequest.current) return; // superseded by a newer selection
      setSelected(response);
      setEditName(response.asset.displayName); setEditDescription(response.asset.description); setEditTags(response.asset.tags.join(", "));
      setFolderRemoveChildIndexes(false); setFolderDeleteManualFiles(false);
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

  async function submitVersion(event: FormEvent) {
    event.preventDefault();
    if (!selected || versionBusy.current || !versionFile) return;
    const targetId = selected.asset.assetId;
    versionBusy.current = true; setVersionPending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      const response = await addAssetVersion(targetId, versionFile, versionNotes);
      setSelected((current) => (current && current.asset.assetId === targetId ? { ...current, asset: response.asset } : current));
      setVersionFile(null); setVersionNotes(""); setVersionFileGeneration((current) => current + 1);
      setDetailError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setDetailError(toAssetDisplayError(caught)); }
    finally { versionBusy.current = false; setVersionPending(false); }
  }

  async function submitRelink(event: FormEvent) {
    event.preventDefault();
    if (!selected || relinkBusy.current || !relinkFile) return;
    const targetId = selected.asset.assetId;
    if (!window.confirm(`'${selected.asset.displayName}' 에셋의 현재 버전 파일을 교체할까요?`)) return;
    relinkBusy.current = true; setRelinkPending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      const response = await relinkAsset(targetId, relinkFile);
      setSelected((current) => (current && current.asset.assetId === targetId ? { ...current, asset: response.asset } : current));
      setRelinkFile(null); setRelinkFileGeneration((current) => current + 1);
      setDetailError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setDetailError(toAssetDisplayError(caught)); }
    finally { relinkBusy.current = false; setRelinkPending(false); }
  }

  async function removeOwnedFile() {
    if (!selected || ownedFileDeleteBusy.current || !selected.canDeleteOwnedFile) return;
    const targetId = selected.asset.assetId;
    if (!window.confirm(`'${selected.asset.displayName}' 에셋과 원본 이미지 파일을 함께 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    ownedFileDeleteBusy.current = true; setOwnedFileDeletePending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      await deleteAssetOwnedFile(targetId);
      setSelected((current) => (current && current.asset.assetId === targetId ? null : current));
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setDetailError(toAssetDisplayError(caught)); }
    finally { ownedFileDeleteBusy.current = false; setOwnedFileDeletePending(false); }
  }

  async function removeFolder() {
    if (!selected || !selected.asset.isFolder || folderDeleteBusy.current) return;
    const targetId = selected.asset.assetId;
    const removeChildIndexes = folderRemoveChildIndexes || folderDeleteManualFiles;
    const message = folderDeleteManualFiles
      ? `'${selected.asset.displayName}' Folder와 하위 항목, 원본 파일을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
      : removeChildIndexes
        ? `'${selected.asset.displayName}' Folder와 하위 항목 색인을 삭제할까요? 원본 파일은 삭제하지 않습니다.`
        : `'${selected.asset.displayName}' Folder만 삭제할까요? 하위 항목은 목록에 그대로 남습니다.`;
    if (!window.confirm(message)) return;
    folderDeleteBusy.current = true; setFolderDeletePending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      await deleteAssetFolder(targetId, { removeChildIndexes, deleteManualFiles: folderDeleteManualFiles });
      setSelected((current) => (current && current.asset.assetId === targetId ? null : current));
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setDetailError(toAssetDisplayError(caught)); }
    finally { folderDeleteBusy.current = false; setFolderDeletePending(false); }
  }

  async function runAudit() {
    const requestId = ++auditRequest.current;
    setAuditLoading(true); setAuditError(null);
    try {
      const response = await listAssetFileAudit();
      if (requestId === auditRequest.current) setAudit(response.entries);
    } catch (caught) {
      if (requestId === auditRequest.current) setAuditError(toAssetDisplayError(caught));
    } finally { if (requestId === auditRequest.current) setAuditLoading(false); }
  }

  async function runLegacyMigration() {
    if (legacyMigrationBusy.current) return;
    legacyMigrationBusy.current = true; setLegacyMigrationPending(true); setLegacyMigrationError(null);
    const listGenerationAtStart = listRequest.current;
    try {
      const response = await runLegacyReferenceMigration();
      setLegacyMigrationResult(response);
      if (response.migratedAssets > 0 && listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setLegacyMigrationError(toAssetDisplayError(caught)); }
    finally { legacyMigrationBusy.current = false; setLegacyMigrationPending(false); }
  }

  const characterFolderChildren = selected?.asset.isFolder && selected.asset.assetType === "character"
    ? selected.asset.childAssetIds.map((childId) => assets?.find((asset) => asset.assetId === childId)).filter((asset): asset is Asset => Boolean(asset))
    : [];

  async function saveCharacterReferenceSet(childAssetIds: string[], thumbnailAssetId: string) {
    if (!selected || referenceSetBusy.current) return;
    const folderId = selected.asset.assetId;
    referenceSetBusy.current = true; setReferenceSetPending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      const response = await updateCharacterFolderReferenceSet(folderId, { childAssetIds, thumbnailAssetId });
      setSelected((current) => current?.asset.assetId === folderId ? { ...current, asset: response.folder } : current);
      setAssets((current) => current?.map((asset) => asset.assetId === response.folder.assetId
        ? response.folder : response.children.find((child) => child.assetId === asset.assetId) ?? asset) ?? current);
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setDetailError(toAssetDisplayError(caught)); }
    finally { referenceSetBusy.current = false; setReferenceSetPending(false); }
  }

  function moveCharacterReference(childId: string, direction: -1 | 1) {
    if (!selected) return;
    const next = [...selected.asset.childAssetIds];
    const index = next.indexOf(childId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= next.length) return;
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    void saveCharacterReferenceSet(next, selected.asset.thumbnailAssetId);
  }

  return <section className="mt-8 space-y-6">
    <header className="flex items-center justify-between"><button type="button" onClick={onBack}>프로젝트 목록으로</button><h2 className="text-2xl font-semibold">Asset Library</h2></header>
    {error && <p role="alert" data-error-code={error.code} className="text-red-300">{error.message}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex gap-3">
      <label>검색 <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>유형 <select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType | "")}><option value="">전체</option>{TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button type="submit">검색</button>
    </form>
    <section aria-label="파일 상태 점검" className="space-y-2 rounded border border-white/10 p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">파일 상태 점검</h3><button type="button" onClick={() => void runAudit()} disabled={auditLoading}>점검 실행</button></div>
      {auditLoading && <p>파일 상태를 확인하는 중...</p>}
      {auditError && <p role="alert" data-testid="audit-error" data-error-code={auditError.code} className="text-red-300">{auditError.message}</p>}
      {audit && audit.length === 0 && !auditLoading && <p>점검할 에셋이 없습니다.</p>}
      {audit && audit.length > 0 && <ul aria-label="파일 상태 목록" className="space-y-1">
        {audit.map((entry) => <li key={entry.assetId}>
          {entry.displayName} · {entry.classification === "healthy" ? "정상" : entry.classification === "missing" ? "파일 없음" : "손상됨"} · {entry.sourceKind === "manual" ? "수동 등록" : "프로젝트 생성"}
          {entry.message && <span> — {entry.message}</span>}
        </li>)}
      </ul>}
    </section>
    <section aria-label="레거시 참고자료 가져오기" className="space-y-2 rounded border border-white/10 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">레거시 참고자료 가져오기</h3>
        <button type="button" onClick={() => void runLegacyMigration()} disabled={legacyMigrationPending}>가져오기 실행</button>
      </div>
      <p>기존 프로젝트의 레거시 참고자료를 Asset Library로 이전합니다. 이미 이전된 항목은 다시 가져오지 않습니다.</p>
      {legacyMigrationPending && <p>레거시 참고자료를 확인하는 중...</p>}
      {legacyMigrationError && <p role="alert" data-testid="legacy-migration-error" data-error-code={legacyMigrationError.code} className="text-red-300">{legacyMigrationError.message}</p>}
      {legacyMigrationResult && !legacyMigrationPending && <p data-testid="legacy-migration-result">
        프로젝트 {legacyMigrationResult.projectsScanned}개 확인, {legacyMigrationResult.migratedAssets}개 이전, 중복 {legacyMigrationResult.deduplicatedAssets}개, 실패 {legacyMigrationResult.failedAssets}개
      </p>}
    </section>

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
      {selected.asset.isFolder && selected.asset.assetType === "character" && <section aria-label="Character reference set" className="space-y-2 rounded border border-white/10 p-3">
        <h4 className="font-semibold">Character reference set</h4>
        {selected.asset.childAssetIds.length === 0 && <p>No child reference images are registered.</p>}
        {selected.asset.childAssetIds.length > 0 && characterFolderChildren.length !== selected.asset.childAssetIds.length && <p role="status">Loading child reference metadata requires the full character list.</p>}
        <ol aria-label="Ordered character reference images" className="space-y-2">
          {characterFolderChildren.map((child, index) => <li key={child.assetId} className="flex items-center gap-2">
            {child.imageAvailable && child.contentUrl && <img src={child.contentUrl} alt="" className="h-10 w-10 object-cover" />}
            <span className="flex-1">{index + 1}. {child.displayName}{selected.asset.thumbnailAssetId === child.assetId ? " (representative)" : ""}</span>
            <button type="button" disabled={referenceSetPending || index === 0} onClick={() => moveCharacterReference(child.assetId, -1)}>Move up</button>
            <button type="button" disabled={referenceSetPending || index === characterFolderChildren.length - 1} onClick={() => moveCharacterReference(child.assetId, 1)}>Move down</button>
            <button type="button" disabled={referenceSetPending || selected.asset.thumbnailAssetId === child.assetId} onClick={() => void saveCharacterReferenceSet(selected.asset.childAssetIds, child.assetId)}>Set representative</button>
          </li>)}
        </ol>
      </section>}
      <form onSubmit={submitEdit} aria-label="에셋 정보 편집" className="space-y-2">
        <label>이름 <input value={editName} required disabled={editPending} onChange={(event) => setEditName(event.target.value)} /></label>
        <label>설명 <input value={editDescription} disabled={editPending} onChange={(event) => setEditDescription(event.target.value)} /></label>
        <label>태그(쉼표 구분) <input value={editTags} disabled={editPending} onChange={(event) => setEditTags(event.target.value)} /></label>
        <button type="submit" disabled={editPending}>변경 저장</button>
      </form>

      {!selected.asset.isFolder && <section aria-label="버전 기록" className="space-y-2 rounded border border-white/10 p-3">
        <h4 className="font-semibold">버전 기록</h4>
        <ol aria-label="버전 목록" className="space-y-1">
          {selected.asset.versions.map((version) => <li key={version.version}>
            v{version.version}{selected.asset.version === version.version ? " (현재)" : ""} · {version.createdAt}{version.notes && ` · ${version.notes}`}
          </li>)}
        </ol>
        <form onSubmit={submitVersion} aria-label="새 버전 추가" className="space-y-2">
          <label>새 버전 이미지 <input key={versionFileGeneration} type="file" accept="image/*" disabled={versionPending} onChange={(event) => setVersionFile(event.target.files?.[0] ?? null)} /></label>
          <label>메모 <input value={versionNotes} disabled={versionPending} onChange={(event) => setVersionNotes(event.target.value)} /></label>
          <button type="submit" disabled={versionPending || !versionFile}>새 버전 추가</button>
        </form>
        <form onSubmit={submitRelink} aria-label="파일 재연결" className="space-y-2">
          <p>현재 버전의 파일이 손상되었거나 잘못된 경우에만 사용하세요.</p>
          <label>교체 이미지 <input key={relinkFileGeneration} type="file" accept="image/*" disabled={relinkPending} onChange={(event) => setRelinkFile(event.target.files?.[0] ?? null)} /></label>
          <button type="submit" disabled={relinkPending || !relinkFile}>현재 버전 재연결</button>
        </form>
      </section>}

      {!selected.asset.isFolder && <>
        <button type="button" onClick={() => void remove()} disabled={selected.usageProjectIds.length > 0 || deletePending}>목록에서 삭제</button>
        {selected.usageProjectIds.length > 0 && <p>사용 중인 에셋은 삭제할 수 없습니다.</p>}
        {selected.canDeleteOwnedFile && <button type="button" onClick={() => void removeOwnedFile()} disabled={ownedFileDeletePending}>에셋과 원본 파일 함께 삭제</button>}
      </>}
      {selected.asset.isFolder && <section aria-label="Folder 삭제" className="space-y-2 rounded border border-white/10 p-3">
        <h4 className="font-semibold">Folder 삭제</h4>
        <label><input type="checkbox" checked={folderRemoveChildIndexes} disabled={folderDeletePending || folderDeleteManualFiles} onChange={(event) => setFolderRemoveChildIndexes(event.target.checked)} /> 하위 항목 색인도 함께 삭제</label>
        <label><input type="checkbox" checked={folderDeleteManualFiles} disabled={folderDeletePending} onChange={(event) => { const checked = event.target.checked; setFolderDeleteManualFiles(checked); if (checked) setFolderRemoveChildIndexes(true); }} /> 하위 항목의 원본 파일도 함께 삭제(수동 등록 항목만 가능)</label>
        <button type="button" onClick={() => void removeFolder()} disabled={selected.usageProjectIds.length > 0 || folderDeletePending}>Folder 삭제</button>
        {selected.usageProjectIds.length > 0 && <p>사용 중인 Folder는 삭제할 수 없습니다.</p>}
      </section>}
    </section>}
  </section>;
}
