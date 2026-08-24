import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Asset, AssetFileAuditEntry, AssetType, CreateAssetMetadata, GetAssetResponse, RunLegacyReferenceMigrationResponse, UpdateAssetMetadataRequest } from "@ai-animation-studio/shared";
import { addAssetVersion, createAsset, deleteAsset, deleteAssetFolder, deleteAssetOwnedFile, getAsset, listAssetFileAudit, listAssets, relinkAsset, runLegacyReferenceMigration, toAssetDisplayError, updateAsset, updateCharacterFolderReferenceSet } from "../api/assetsApi.js";
import { Spinner } from "./Spinner.js";

interface Props { onBack: () => void; initialQuery?: string }
const TYPES: Array<{ value: AssetType; label: string }> = [
  { value: "character", label: "캐릭터" }, { value: "style", label: "스타일" },
  { value: "background", label: "배경" }, { value: "object", label: "오브젝트" },
  { value: "general_reference", label: "일반 참고" },
];
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const IMPORT_VALIDATION_MESSAGE = "이미지 파일과 이름을 모두 입력해 주세요.";

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const dangerOutlineButton =
  "rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function SectionHeading({ children }: { children: React.ReactNode }) {
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

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <header className="flex items-center justify-between">
        <button type="button" className={outlineButton} onClick={onBack}>
          프로젝트 목록으로
        </button>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          Asset Library
        </h2>
      </header>
      {error && (
        <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-300">
          검색
          <input className={fieldClassName} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="text-sm text-slate-300">
          유형
          <select className={fieldClassName} value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType | "")}>
            <option value="">전체</option>
            {TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButton}>
          검색
        </button>
      </form>

      <section aria-label="파일 상태 점검" className={cardSection}>
        <div className="flex items-center justify-between gap-3">
          <SectionHeading>파일 상태 점검</SectionHeading>
          <button type="button" className={smallOutlineButton} onClick={() => void runAudit()} disabled={auditLoading}>
            점검 실행
          </button>
        </div>
        {auditLoading && <Spinner label="파일 상태를 확인하는 중..." />}
        {auditError && (
          <p role="alert" data-testid="audit-error" data-error-code={auditError.code} className="text-sm text-rose-400">
            {auditError.message}
          </p>
        )}
        {audit && audit.length === 0 && !auditLoading && <p className="text-sm text-slate-400">점검할 에셋이 없습니다.</p>}
        {audit && audit.length > 0 && (
          <ul aria-label="파일 상태 목록" className="space-y-1.5 text-sm text-slate-300">
            {audit.map((entry) => (
              <li key={entry.assetId} className="rounded-lg border border-white/10 bg-slate-950/40 p-2.5">
                {entry.displayName} · {entry.classification === "healthy" ? "정상" : entry.classification === "missing" ? "파일 없음" : "손상됨"} ·{" "}
                {entry.sourceKind === "manual" ? "수동 등록" : "프로젝트 생성"}
                {entry.message && <span> — {entry.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="레거시 참고자료 가져오기" className={cardSection}>
        <div className="flex items-center justify-between gap-3">
          <SectionHeading>레거시 참고자료 가져오기</SectionHeading>
          <button type="button" className={smallOutlineButton} onClick={() => void runLegacyMigration()} disabled={legacyMigrationPending}>
            가져오기 실행
          </button>
        </div>
        <p className="text-sm text-slate-400">기존 프로젝트의 레거시 참고자료를 Asset Library로 이전합니다. 이미 이전된 항목은 다시 가져오지 않습니다.</p>
        {legacyMigrationPending && <Spinner label="레거시 참고자료를 확인하는 중..." />}
        {legacyMigrationError && (
          <p role="alert" data-testid="legacy-migration-error" data-error-code={legacyMigrationError.code} className="text-sm text-rose-400">
            {legacyMigrationError.message}
          </p>
        )}
        {legacyMigrationResult && !legacyMigrationPending && (
          <p data-testid="legacy-migration-result" className="text-sm text-slate-300">
            프로젝트 {legacyMigrationResult.projectsScanned}개 확인, {legacyMigrationResult.migratedAssets}개 이전, 중복 {legacyMigrationResult.deduplicatedAssets}개, 실패{" "}
            {legacyMigrationResult.failedAssets}개
          </p>
        )}
      </section>

      {loading && !assets && <Spinner label="에셋을 불러오는 중..." />}
      {assets && assets.length === 0 && !loading && <p className="text-sm text-slate-400">등록된 에셋이 없습니다.</p>}
      {assets && (
        <ul aria-label="에셋 목록" className="grid gap-3 sm:grid-cols-2">
          {assets.map((asset) => (
            <li key={asset.assetId}>
              <button
                type="button"
                onClick={() => void open(asset.assetId)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/70 p-3 text-left transition hover:border-violet-400/40 hover:bg-slate-900"
              >
                {asset.imageAvailable && asset.contentUrl ? (
                  <img src={asset.contentUrl} alt="" className="h-24 w-full rounded-lg object-cover" />
                ) : (
                  <span className="flex h-24 w-full items-center justify-center rounded-lg border border-white/5 bg-slate-950/40 text-sm text-slate-500">
                    이미지 없음
                  </span>
                )}
                <strong className="mt-2 block text-slate-100">{asset.displayName}</strong>
                <span className="text-xs text-slate-400"> · {asset.assetType}</span>
                <p className="mt-1 text-sm text-slate-400">{asset.description}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitImport} aria-label="에셋 가져오기" className={cardSection}>
        <SectionHeading>이미지 가져오기</SectionHeading>
        {importValidationError && (
          <p role="alert" data-testid="import-validation-error" className="text-sm text-rose-400">
            {importValidationError}
          </p>
        )}
        <label className="block text-sm text-slate-300">
          이미지 파일
          <input
            key={fileInputGeneration}
            type="file"
            accept="image/*"
            disabled={importPending}
            className="mt-1.5 block w-full text-sm text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-slate-200 disabled:opacity-50"
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); setImportValidationError(null); }}
          />
        </label>
        <label className="block text-sm text-slate-300">
          이름
          <input
            value={importName}
            disabled={importPending}
            className={fieldClassName}
            onChange={(event) => { setImportName(event.target.value); setImportValidationError(null); }}
          />
        </label>
        <label className="block text-sm text-slate-300">
          유형
          <select value={importType} disabled={importPending} className={fieldClassName} onChange={(event) => setImportType(event.target.value as AssetType)}>
            {TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          설명
          <input value={importDescription} disabled={importPending} className={fieldClassName} onChange={(event) => setImportDescription(event.target.value)} />
        </label>
        <label className="block text-sm text-slate-300">
          태그(쉼표 구분)
          <input value={importTags} disabled={importPending} className={fieldClassName} onChange={(event) => setImportTags(event.target.value)} />
        </label>
        <button type="submit" disabled={importPending} className={primaryButton}>
          가져오기
        </button>
      </form>

      {detailLoading && <Spinner label="선택한 에셋 정보를 불러오는 중..." />}
      {detailError && (
        <p role="alert" data-testid="asset-detail-error" data-error-code={detailError.code} className="text-sm text-rose-400">
          {detailError.message}
        </p>
      )}
      {selected && (
        <section aria-label="에셋 상세" className="space-y-4 rounded-2xl border border-violet-400/30 bg-slate-900/70 p-5">
          <h3 className="text-xl font-semibold text-slate-100">{selected.asset.displayName}</h3>
          {selected.asset.imageAvailable && selected.asset.contentUrl && (
            <img src={selected.asset.contentUrl} alt={`${selected.asset.displayName} 미리보기`} className="max-h-64 rounded-xl object-contain" />
          )}
          <p className="text-sm text-slate-300">소유권: {selected.ownership}</p>
          <p className="text-sm text-slate-300">사용 프로젝트: {selected.usageProjectIds.length ? selected.usageProjectIds.join(", ") : "없음"}</p>

          {selected.asset.isFolder && selected.asset.assetType === "character" && (
            <section aria-label="Character reference set" className="space-y-2 rounded-xl border border-white/10 bg-slate-950/30 p-3.5">
              <h4 className="text-sm font-semibold text-slate-200">Character reference set</h4>
              {selected.asset.childAssetIds.length === 0 && <p className="text-sm text-slate-400">No child reference images are registered.</p>}
              {selected.asset.childAssetIds.length > 0 && characterFolderChildren.length !== selected.asset.childAssetIds.length && (
                <p role="status" className="text-sm text-slate-400">
                  Loading child reference metadata requires the full character list.
                </p>
              )}
              <ol aria-label="Ordered character reference images" className="space-y-2">
                {characterFolderChildren.map((child, index) => (
                  <li key={child.assetId} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 p-2 text-sm text-slate-300">
                    {child.imageAvailable && child.contentUrl && <img src={child.contentUrl} alt="" className="h-10 w-10 rounded-md object-cover" />}
                    <span className="flex-1">
                      {index + 1}. {child.displayName}
                      {selected.asset.thumbnailAssetId === child.assetId ? " (representative)" : ""}
                    </span>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                      disabled={referenceSetPending || index === 0}
                      onClick={() => moveCharacterReference(child.assetId, -1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                      disabled={referenceSetPending || index === characterFolderChildren.length - 1}
                      onClick={() => moveCharacterReference(child.assetId, 1)}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-emerald-400/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                      disabled={referenceSetPending || selected.asset.thumbnailAssetId === child.assetId}
                      onClick={() => void saveCharacterReferenceSet(selected.asset.childAssetIds, child.assetId)}
                    >
                      Set representative
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <form onSubmit={submitEdit} aria-label="에셋 정보 편집" className="space-y-3 rounded-xl border border-white/10 bg-slate-950/30 p-3.5">
            <label className="block text-sm text-slate-300">
              이름
              <input value={editName} required disabled={editPending} className={fieldClassName} onChange={(event) => setEditName(event.target.value)} />
            </label>
            <label className="block text-sm text-slate-300">
              설명
              <input value={editDescription} disabled={editPending} className={fieldClassName} onChange={(event) => setEditDescription(event.target.value)} />
            </label>
            <label className="block text-sm text-slate-300">
              태그(쉼표 구분)
              <input value={editTags} disabled={editPending} className={fieldClassName} onChange={(event) => setEditTags(event.target.value)} />
            </label>
            <button type="submit" disabled={editPending} className={primaryButton}>
              변경 저장
            </button>
          </form>

          {!selected.asset.isFolder && (
            <section aria-label="버전 기록" className="space-y-3 rounded-xl border border-white/10 bg-slate-950/30 p-3.5">
              <h4 className="text-sm font-semibold text-slate-200">버전 기록</h4>
              <ol aria-label="버전 목록" className="space-y-1 text-sm text-slate-300">
                {selected.asset.versions.map((version) => (
                  <li key={version.version}>
                    v{version.version}
                    {selected.asset.version === version.version ? " (현재)" : ""} · {version.createdAt}
                    {version.notes && ` · ${version.notes}`}
                  </li>
                ))}
              </ol>
              <form onSubmit={submitVersion} aria-label="새 버전 추가" className="space-y-2">
                <label className="block text-sm text-slate-300">
                  새 버전 이미지
                  <input
                    key={versionFileGeneration}
                    type="file"
                    accept="image/*"
                    disabled={versionPending}
                    className="mt-1.5 block w-full text-sm text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-slate-200 disabled:opacity-50"
                    onChange={(event) => setVersionFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  메모
                  <input value={versionNotes} disabled={versionPending} className={fieldClassName} onChange={(event) => setVersionNotes(event.target.value)} />
                </label>
                <button type="submit" disabled={versionPending || !versionFile} className={outlineButton}>
                  새 버전 추가
                </button>
              </form>
              <form onSubmit={submitRelink} aria-label="파일 재연결" className="space-y-2">
                <p className="text-sm text-slate-400">현재 버전의 파일이 손상되었거나 잘못된 경우에만 사용하세요.</p>
                <label className="block text-sm text-slate-300">
                  교체 이미지
                  <input
                    key={relinkFileGeneration}
                    type="file"
                    accept="image/*"
                    disabled={relinkPending}
                    className="mt-1.5 block w-full text-sm text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-slate-200 disabled:opacity-50"
                    onChange={(event) => setRelinkFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button type="submit" disabled={relinkPending || !relinkFile} className={outlineButton}>
                  현재 버전 재연결
                </button>
              </form>
            </section>
          )}

          {!selected.asset.isFolder && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={dangerOutlineButton} onClick={() => void remove()} disabled={selected.usageProjectIds.length > 0 || deletePending}>
                목록에서 삭제
              </button>
              {selected.usageProjectIds.length > 0 && <p className="text-sm text-slate-400">사용 중인 에셋은 삭제할 수 없습니다.</p>}
              {selected.canDeleteOwnedFile && (
                <button type="button" className={dangerOutlineButton} onClick={() => void removeOwnedFile()} disabled={ownedFileDeletePending}>
                  에셋과 원본 파일 함께 삭제
                </button>
              )}
            </div>
          )}
          {selected.asset.isFolder && (
            <section aria-label="Folder 삭제" className="space-y-2 rounded-xl border border-rose-400/20 bg-rose-950/10 p-3.5">
              <h4 className="text-sm font-semibold text-slate-200">Folder 삭제</h4>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-violet-500"
                  checked={folderRemoveChildIndexes}
                  disabled={folderDeletePending || folderDeleteManualFiles}
                  onChange={(event) => setFolderRemoveChildIndexes(event.target.checked)}
                />
                하위 항목 색인도 함께 삭제
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-violet-500"
                  checked={folderDeleteManualFiles}
                  disabled={folderDeletePending}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setFolderDeleteManualFiles(checked);
                    if (checked) setFolderRemoveChildIndexes(true);
                  }}
                />
                하위 항목의 원본 파일도 함께 삭제(수동 등록 항목만 가능)
              </label>
              <button
                type="button"
                className={dangerOutlineButton}
                onClick={() => void removeFolder()}
                disabled={selected.usageProjectIds.length > 0 || folderDeletePending}
              >
                Folder 삭제
              </button>
              {selected.usageProjectIds.length > 0 && <p className="text-sm text-slate-400">사용 중인 Folder는 삭제할 수 없습니다.</p>}
            </section>
          )}
        </section>
      )}
    </section>
  );
}
