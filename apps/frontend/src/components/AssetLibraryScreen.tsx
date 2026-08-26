import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Asset, AssetFileAuditEntry, AssetType, CreateAssetMetadata, GetAssetResponse, RunLegacyReferenceMigrationResponse, UpdateAssetMetadataRequest } from "@ai-animation-studio/shared";
import { addAssetVersion, createAsset, createAssetFolder, deleteAsset, deleteAssetFolder, deleteAssetOwnedFile, getAsset, listAssetFileAudit, listAssets, relinkAsset, runLegacyReferenceMigration, setAssetParentFolder, toAssetDisplayError, updateAsset, updateCharacterFolderReferenceSet } from "../api/assetsApi.js";
import { formatDateTime } from "../utils/formatDateTime.js";
import { Spinner } from "./Spinner.js";

interface Props { onBack: () => void; initialQuery?: string }
const TYPES: Array<{ value: AssetType; label: string }> = [
  { value: "character", label: "캐릭터" }, { value: "style", label: "스타일" },
  { value: "background", label: "배경" }, { value: "object", label: "오브젝트" },
  { value: "general_reference", label: "일반 참고" },
];
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const IMPORT_VALIDATION_MESSAGE = "이미지 파일과 이름을 모두 입력해 주세요.";
// Mirrors the backend's CHARACTER_ROLES (apps/backend/src/assets/assets.repository.ts) in a stable, labeled order.
const CHARACTER_ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "front", label: "정면" }, { value: "side", label: "옆모습" }, { value: "back", label: "뒷모습" },
  { value: "left45", label: "왼쪽 45도" }, { value: "right45", label: "오른쪽 45도" },
  { value: "expression", label: "표정" }, { value: "thumbnail", label: "썸네일" }, { value: "other", label: "기타" },
];

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-sm font-medium text-slate-200 shadow-sm hover:border-white/30 hover:bg-white/10 disabled:opacity-50";
const dangerOutlineButton =
  "rounded-full border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 shadow-sm hover:border-rose-400/60 hover:bg-rose-500/15 disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-200 hover:border-white/30 hover:bg-white/10 disabled:opacity-50";
const smallAddButton =
  "rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:border-emerald-400/60 hover:bg-emerald-500/15 disabled:opacity-50";
const smallRemoveButton =
  "rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300 hover:border-rose-400/60 hover:bg-rose-500/15 disabled:opacity-50";
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
  /**
   * Failures of the four confirmed actions, shown inside the confirmation panel itself.
   *
   * They used to close the panel first and then write the error into the detail-level slot near the top of a
   * very long pane — hundreds of pixels above the button that was just pressed, and usually off-screen. The
   * dialog vanished and the item stayed put, so a rejected delete looked exactly like a dead button.
   */
  const [confirmError, setConfirmError] = useState<{ code: string; message: string } | null>(null);
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
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [folderRemoveChildIndexes, setFolderRemoveChildIndexes] = useState(false);
  const [folderDeleteManualFiles, setFolderDeleteManualFiles] = useState(false);
  const [folderDeletePending, setFolderDeletePending] = useState(false);
  const [folderCreateName, setFolderCreateName] = useState("");
  const [folderCreatePending, setFolderCreatePending] = useState(false);
  const [folderCreateError, setFolderCreateError] = useState<{ code: string; message: string } | null>(null);
  const [folderChildren, setFolderChildren] = useState<Asset[] | null>(null);
  const [folderChildrenLoading, setFolderChildrenLoading] = useState(false);
  const [folderChildrenError, setFolderChildrenError] = useState<{ code: string; message: string } | null>(null);
  const [folderLinkQuery, setFolderLinkQuery] = useState("");
  const [folderLinkResults, setFolderLinkResults] = useState<Asset[] | null>(null);
  const [folderLinkSearchLoading, setFolderLinkSearchLoading] = useState(false);
  const [folderLinkSearchError, setFolderLinkSearchError] = useState<{ code: string; message: string } | null>(null);
  const [folderMutationPending, setFolderMutationPending] = useState(false);
  const [folderMutationError, setFolderMutationError] = useState<{ code: string; message: string } | null>(null);
  // Registering a brand-new image straight into the open Folder — kept apart from the top-level import form's
  // state so a half-typed entry in one is never clobbered by the other.
  const [folderUploadFile, setFolderUploadFile] = useState<File | null>(null);
  const [folderUploadName, setFolderUploadName] = useState("");
  const [folderUploadDescription, setFolderUploadDescription] = useState("");
  const [folderUploadPending, setFolderUploadPending] = useState(false);
  const [folderUploadValidationError, setFolderUploadValidationError] = useState<string | null>(null);
  const [folderUploadInputGeneration, setFolderUploadInputGeneration] = useState(0);
  // In-screen confirmation for destructive/replacing actions — replaces window.confirm(), which blocks
  // the whole renderer (and freezes automation/Electron flows) as a native modal.
  const [confirmAction, setConfirmAction] = useState<"delete-asset" | "relink" | "delete-owned-file" | "delete-folder" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [folderCreateOpen, setFolderCreateOpen] = useState(false);
  const [folderCreateType, setFolderCreateType] = useState<AssetType>("character");
  const [folderCreateDescription, setFolderCreateDescription] = useState("");
  // Per-child "개별 특징" drafts, keyed by child assetId; a key exists only while the draft differs from
  // the saved value. Cleared whenever the selected folder changes.
  const [childDescriptionDrafts, setChildDescriptionDrafts] = useState<Record<string, string>>({});
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const auditRequest = useRef(0);
  const folderChildrenRequest = useRef(0);
  const importBusy = useRef(false);
  const editBusy = useRef(false);
  const deleteBusy = useRef(false);
  const referenceSetBusy = useRef(false);
  const versionBusy = useRef(false);
  const relinkBusy = useRef(false);
  const legacyMigrationBusy = useRef(false);
  const ownedFileDeleteBusy = useRef(false);
  const folderDeleteBusy = useRef(false);
  const folderCreateBusy = useRef(false);
  const folderMutationBusy = useRef(false);
  const folderUploadBusy = useRef(false);

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
      setFolderRemoveChildIndexes(false); setFolderDeleteManualFiles(false); setConfirmAction(null); setConfirmError(null);
    } catch (caught) {
      if (requestId !== detailRequest.current) return; // superseded by a newer selection
      setSelected(null); setDetailError(toAssetDisplayError(caught));
    } finally { if (requestId === detailRequest.current) setDetailLoading(false); }
  }

  // Fetches full detail for every child of the selected Folder directly (rather than relying on
  // whatever happens to already be loaded in `assets`), so reordering/role editing works even for children
  // outside the current search/filter — the "일부 하위 이미지 정보를 불러오지 못했습니다" case below only
  // fires on a genuine per-child fetch failure now, not on a merely-unloaded one. Folders of every
  // AssetType are supported (the character-only restriction was lifted with the Round 11 contract).
  useEffect(() => {
    const folder = selected?.asset;
    setChildDescriptionDrafts({});
    if (!folder || !folder.isFolder) {
      setFolderChildren(null); setFolderChildrenError(null); setFolderLinkResults(null); setFolderLinkQuery("");
      setFolderLinkSearchError(null); setFolderMutationError(null);
      return;
    }
    const requestId = ++folderChildrenRequest.current;
    if (folder.childAssetIds.length === 0) { setFolderChildren([]); setFolderChildrenError(null); return; }
    setFolderChildrenLoading(true);
    Promise.allSettled(folder.childAssetIds.map((childId) => getAsset(childId))).then((results) => {
      if (requestId !== folderChildrenRequest.current) return;
      const children: Asset[] = [];
      let missing = false;
      results.forEach((outcome) => { if (outcome.status === "fulfilled") children.push(outcome.value.asset); else missing = true; });
      setFolderChildren(children);
      setFolderChildrenError(missing ? { code: "CLIENT_PARTIAL_LOAD", message: "일부 하위 이미지 정보를 불러오지 못했습니다." } : null);
    }).finally(() => { if (requestId === folderChildrenRequest.current) setFolderChildrenLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.asset.assetId, selected?.asset.isFolder, selected?.asset.assetType, selected?.asset.childAssetIds.join(",")]);

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
    setConfirmError(null);
    deleteBusy.current = true; setDeletePending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      await deleteAsset(targetId);
      setConfirmAction(null);
      setSelected((current) => (current && current.asset.assetId === targetId ? null : current));
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setConfirmError(toAssetDisplayError(caught)); }
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

  function submitRelink(event: FormEvent) {
    event.preventDefault();
    if (!selected || relinkBusy.current || !relinkFile) return;
    setConfirmAction("relink");
  }

  async function confirmRelink() {
    if (!selected || relinkBusy.current || !relinkFile) return;
    const targetId = selected.asset.assetId;
    setConfirmError(null);
    relinkBusy.current = true; setRelinkPending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      const response = await relinkAsset(targetId, relinkFile);
      setConfirmAction(null);
      setSelected((current) => (current && current.asset.assetId === targetId ? { ...current, asset: response.asset } : current));
      setRelinkFile(null); setRelinkFileGeneration((current) => current + 1);
      setDetailError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setConfirmError(toAssetDisplayError(caught)); }
    finally { relinkBusy.current = false; setRelinkPending(false); }
  }

  async function removeOwnedFile() {
    if (!selected || ownedFileDeleteBusy.current || !selected.canDeleteOwnedFile) return;
    const targetId = selected.asset.assetId;
    setConfirmError(null);
    ownedFileDeleteBusy.current = true; setOwnedFileDeletePending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      await deleteAssetOwnedFile(targetId);
      setConfirmAction(null);
      setSelected((current) => (current && current.asset.assetId === targetId ? null : current));
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) { setConfirmError(toAssetDisplayError(caught)); }
    finally { ownedFileDeleteBusy.current = false; setOwnedFileDeletePending(false); }
  }

  async function removeFolder() {
    if (!selected || !selected.asset.isFolder || folderDeleteBusy.current) return;
    const targetId = selected.asset.assetId;
    const removeChildIndexes = folderRemoveChildIndexes || folderDeleteManualFiles;
    const deleteManualFiles = folderDeleteManualFiles;
    setConfirmError(null);
    folderDeleteBusy.current = true; setFolderDeletePending(true);
    const listGenerationAtStart = listRequest.current;
    try {
      await deleteAssetFolder(targetId, { removeChildIndexes, deleteManualFiles });
      setConfirmAction(null);
      setSelected((current) => (current && current.asset.assetId === targetId ? null : current));
      setError(null);
      if (listRequest.current === listGenerationAtStart) await load();
    } catch (caught) {
      const displayed = toAssetDisplayError(caught);
      // The generic "이 에셋은 현재 수정할 수 없습니다" is true but useless here: the backend refuses the whole
      // delete when any child was not registered by hand (assets.repository.ts checks source_project_id
      // against the manual library). Naming the cause is what makes the checkbox actionable.
      setConfirmError(
        displayed.code === "ASSET_MUTATION_UNSUPPORTED" && deleteManualFiles
          ? {
              code: displayed.code,
              message:
                "이 폴더에는 직접 등록하지 않은 항목(프로젝트가 만든 이미지 등)이 있어서 원본 파일까지 지울 수는 없습니다. '하위 항목의 원본 파일도 함께 삭제'를 끄고 다시 시도해 주세요.",
            }
          : displayed,
      );
    }
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

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (folderCreateBusy.current || !folderCreateName.trim()) return;
    folderCreateBusy.current = true; setFolderCreatePending(true); setFolderCreateError(null);
    const listGenerationAtStart = listRequest.current;
    try {
      const response = await createAssetFolder({
        assetType: folderCreateType,
        displayName: folderCreateName.trim(),
        description: folderCreateDescription.trim() || undefined,
      });
      setFolderCreateName(""); setFolderCreateDescription("");
      if (listRequest.current === listGenerationAtStart) await load();
      await open(response.asset.assetId);
    } catch (caught) { setFolderCreateError(toAssetDisplayError(caught)); }
    finally { folderCreateBusy.current = false; setFolderCreatePending(false); }
  }

  async function searchFolderLinkCandidates(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setFolderLinkSearchLoading(true); setFolderLinkSearchError(null);
    try {
      // Candidates share the folder's own type, so a background folder collects background images, etc.
      const response = await listAssets({ query: folderLinkQuery || undefined, assetType: selected.asset.assetType });
      setFolderLinkResults(response.assets);
    } catch (caught) { setFolderLinkSearchError(toAssetDisplayError(caught)); }
    finally { setFolderLinkSearchLoading(false); }
  }

  /**
   * Registers a new image and drops it straight into the open Folder. It is two requests because
   * `CreateAssetMetadata` has no `parentFolderId` — creation and filing are separate endpoints. If the second
   * one fails the image is registered but unfiled, which is recoverable but invisible, so the error below says
   * exactly that instead of the generic failure text; otherwise someone goes hunting for a file they think
   * vanished. The Folder's own `assetType` is used, so a character Folder can only ever collect characters.
   */
  async function submitFolderUpload(event: FormEvent) {
    event.preventDefault();
    if (!selected || folderUploadBusy.current) return;
    if (!folderUploadFile || !folderUploadName.trim()) { setFolderUploadValidationError(IMPORT_VALIDATION_MESSAGE); return; }
    const folderId = selected.asset.assetId;
    const assetType = selected.asset.assetType;
    const attemptedName = folderUploadName.trim();
    setFolderUploadValidationError(null);
    folderUploadBusy.current = true; setFolderUploadPending(true); setFolderMutationError(null);
    let createdAssetId: string | null = null;
    try {
      const response = await createAsset(folderUploadFile, { assetType, displayName: attemptedName, description: folderUploadDescription.trim() });
      createdAssetId = response.asset.assetId;
      await setAssetParentFolder(createdAssetId, { parentFolderId: folderId });
      setFolderUploadFile(null); setFolderUploadName(""); setFolderUploadDescription("");
      setFolderUploadInputGeneration((current) => current + 1);
      await load();
      await open(folderId);
    } catch (caught) {
      const displayed = toAssetDisplayError(caught);
      setFolderMutationError(createdAssetId
        ? { code: displayed.code, message: `이미지는 "${attemptedName}"(으)로 등록됐지만 이 폴더에 넣지는 못했습니다(${displayed.message}). 아래 "이미지 검색"에서 찾아 폴더에 넣어 주세요.` }
        : displayed);
    }
    finally { folderUploadBusy.current = false; setFolderUploadPending(false); }
  }

  async function linkAssetToFolder(assetId: string) {
    if (!selected || folderMutationBusy.current) return;
    const folderId = selected.asset.assetId;
    folderMutationBusy.current = true; setFolderMutationPending(true); setFolderMutationError(null);
    try {
      await setAssetParentFolder(assetId, { parentFolderId: folderId });
      setFolderLinkResults((current) => current?.filter((asset) => asset.assetId !== assetId) ?? current);
      await open(folderId);
    } catch (caught) { setFolderMutationError(toAssetDisplayError(caught)); }
    finally { folderMutationBusy.current = false; setFolderMutationPending(false); }
  }

  async function unlinkAssetFromFolder(assetId: string) {
    if (!selected || folderMutationBusy.current) return;
    const folderId = selected.asset.assetId;
    folderMutationBusy.current = true; setFolderMutationPending(true); setFolderMutationError(null);
    try {
      await setAssetParentFolder(assetId, { parentFolderId: null });
      await open(folderId);
    } catch (caught) { setFolderMutationError(toAssetDisplayError(caught)); }
    finally { folderMutationBusy.current = false; setFolderMutationPending(false); }
  }

  async function updateChildRole(assetId: string, role: string) {
    if (folderMutationBusy.current) return;
    folderMutationBusy.current = true; setFolderMutationPending(true); setFolderMutationError(null);
    try {
      const response = await updateAsset(assetId, { role });
      setFolderChildren((current) => current?.map((asset) => (asset.assetId === assetId ? response.asset : asset)) ?? current);
    } catch (caught) { setFolderMutationError(toAssetDisplayError(caught)); }
    finally { folderMutationBusy.current = false; setFolderMutationPending(false); }
  }

  /** Saves one child's "개별 특징" (its own description, combined with the folder's common description in AI prompts). */
  async function saveChildDescription(assetId: string) {
    const draft = childDescriptionDrafts[assetId];
    if (draft === undefined || folderMutationBusy.current) return;
    folderMutationBusy.current = true; setFolderMutationPending(true); setFolderMutationError(null);
    try {
      const response = await updateAsset(assetId, { description: draft.trim() });
      setFolderChildren((current) => current?.map((asset) => (asset.assetId === assetId ? response.asset : asset)) ?? current);
      setChildDescriptionDrafts(({ [assetId]: _saved, ...rest }) => rest);
    } catch (caught) { setFolderMutationError(toAssetDisplayError(caught)); }
    finally { folderMutationBusy.current = false; setFolderMutationPending(false); }
  }

  /** Any of the four confirmed actions being in flight — the panel stays put and its buttons go quiet. */
  const confirmPending = deletePending || relinkPending || ownedFileDeletePending || folderDeletePending;

  return (
    <section className="mt-8 max-w-6xl space-y-5">
      <header className="space-y-1.5">
        <button type="button" className="text-xs text-slate-400 hover:text-slate-300" onClick={onBack}>
          <span aria-hidden="true">←</span> 프로젝트 목록으로
        </button>
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
            이미지 보관함
          </h1>
        </div>
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
        <button
          type="button"
          data-testid="import-toggle"
          aria-expanded={importOpen}
          className={outlineButton}
          onClick={() => setImportOpen((current) => !current)}
        >
          새 에셋 등록
        </button>
        <button
          type="button"
          data-testid="folder-create-toggle"
          aria-expanded={folderCreateOpen}
          className={outlineButton}
          onClick={() => setFolderCreateOpen((current) => !current)}
        >
          새 폴더 만들기
        </button>
      </form>

      <div className="rounded-2xl border border-white/10 bg-slate-900/40">
        <button
          type="button"
          data-testid="asset-maintenance-toggle"
          aria-expanded={maintenanceOpen}
          className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium text-slate-300 hover:bg-white/5"
          onClick={() => setMaintenanceOpen((current) => !current)}
        >
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
            />
            관리 도구 (파일 점검 · 레거시 자료 이전)
          </span>
          <span aria-hidden="true" className="text-xs text-slate-500">
            {maintenanceOpen ? "숨기기 ▲" : "펼치기 ▼"}
          </span>
        </button>
        {maintenanceOpen && (
          <div className="space-y-4 px-4 pb-4">
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

            <section aria-label="레거시 참고자료 일괄 이전" className={cardSection}>
              <div className="flex items-center justify-between gap-3">
                <SectionHeading>레거시 참고자료 일괄 이전</SectionHeading>
                <button type="button" className={smallOutlineButton} onClick={() => void runLegacyMigration()} disabled={legacyMigrationPending}>
                  일괄 이전 실행
                </button>
              </div>
              <p className="text-sm text-slate-400">다른 프로젝트에 남아 있는 옛 참고자료를 한 번에 이 라이브러리로 옮겨 등록합니다. 이미 이전된 항목은 다시 옮기지 않습니다.</p>
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
          </div>
        )}
      </div>

      <div className="gap-5 space-y-5 lg:grid lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)] lg:items-start lg:space-y-0">
      <div className="space-y-3">
      {loading && !assets && <Spinner label="에셋을 불러오는 중..." />}
      {assets && assets.length === 0 && !loading && <p className="text-sm text-slate-400">등록된 에셋이 없습니다.</p>}
      {assets && (
        <ul aria-label="에셋 목록" className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {assets.map((asset) => (
            <li key={asset.assetId}>
              <button
                type="button"
                onClick={() => void open(asset.assetId)}
                className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition hover:border-violet-400/40 hover:bg-slate-900 ${
                  selected?.asset.assetId === asset.assetId ? "border-violet-400/50 bg-slate-900" : "border-white/10 bg-slate-900/70"
                }`}
              >
                {asset.imageAvailable && asset.contentUrl ? (
                  <img src={asset.contentUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-slate-950/40 text-base text-slate-500">
                    {asset.isFolder ? "📁" : "🖼"}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-slate-100">{asset.displayName}</strong>
                  <span className="text-xs text-slate-400">
                    {TYPES.find((item) => item.value === asset.assetType)?.label ?? asset.assetType}
                    {asset.isFolder ? " 폴더" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>

      <div className="space-y-4">
      {!selected && !detailLoading && !detailError && !importOpen && !folderCreateOpen && (
        <p className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-slate-500">
          왼쪽 목록에서 항목을 선택하면 상세 정보가 여기에 표시됩니다. 새 항목은 위의 "새 에셋 등록" 또는 "새 폴더 만들기" 버튼으로 추가할 수 있습니다.
        </p>
      )}
      {importOpen && (
      <form onSubmit={submitImport} aria-label="에셋 가져오기" className={cardSection}>
        <SectionHeading>새 에셋 등록</SectionHeading>
        <p className="text-sm text-slate-400">이미지를 업로드해 새 에셋으로 등록합니다.</p>
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
        {/* A loose character image is a dead end: the project's cast picker only accepts character Folders, so
            this image would never appear there. Said here rather than blocked, because it is still a legitimate
            way to stage an image you are about to file into a Folder. */}
        {importType === "character" && (
          <p data-testid="loose-character-hint" className="text-sm text-amber-300">
            낱장으로 등록한 캐릭터 이미지는 프로젝트의 등장 캐릭터 목록에 나타나지 않습니다. 그 목록은 캐릭터 <strong className="text-amber-200">폴더</strong>만 받습니다.
            먼저 "새 폴더 만들기"로 폴더를 만들고, 폴더 상세의 "이 폴더에 새 이미지 등록"을 쓰시는 편이 낫습니다.
          </p>
        )}
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
      )}

      {folderCreateOpen && (
      <form onSubmit={createFolder} aria-label="폴더 만들기" className={cardSection}>
        <SectionHeading>새 폴더 만들기</SectionHeading>
        <p className="text-sm text-slate-400">
          이미지 없이 이름만으로 폴더를 먼저 만든 다음, 폴더 상세에서 관련 이미지를 그 안에 추가할 수 있습니다. 캐릭터 폴더라면
          정면·옆모습·뒷모습처럼 같은 캐릭터의 여러 모습을, 배경·소품 폴더라면 같은 장소나 물건의 여러 참고 이미지를 모아두는 식입니다.
          폴더 설명에는 안에 담긴 이미지들이 공통으로 갖는 특징을 적어두면 AI 생성 시 함께 전달됩니다.
        </p>
        <label className="block text-sm text-slate-300">
          폴더 이름
          <input
            value={folderCreateName}
            disabled={folderCreatePending}
            className={fieldClassName}
            onChange={(event) => setFolderCreateName(event.target.value)}
          />
        </label>
        <label className="block text-sm text-slate-300">
          폴더 유형
          <select
            value={folderCreateType}
            disabled={folderCreatePending}
            className={fieldClassName}
            onChange={(event) => setFolderCreateType(event.target.value as AssetType)}
          >
            {TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          공통 특징(선택)
          <input
            value={folderCreateDescription}
            disabled={folderCreatePending}
            className={fieldClassName}
            placeholder="예: 파란 망토를 두른 판다 기사 — 안의 모든 이미지에 공통되는 특징"
            onChange={(event) => setFolderCreateDescription(event.target.value)}
          />
        </label>
        {folderCreateError && (
          <p role="alert" data-testid="folder-create-error" data-error-code={folderCreateError.code} className="text-sm text-rose-400">
            {folderCreateError.message}
          </p>
        )}
        <button type="submit" disabled={folderCreatePending || !folderCreateName.trim()} className={primaryButton}>
          {folderCreatePending ? "만드는 중…" : "폴더 만들기"}
        </button>
      </form>
      )}

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

          {selected.asset.isFolder && (
            <section aria-label="폴더 구성" className="space-y-3 rounded-xl border border-white/10 bg-slate-950/30 p-3.5">
              <h4 className="text-sm font-semibold text-slate-200">폴더 구성</h4>
              <p className="text-xs text-slate-500">
                {selected.asset.assetType === "character"
                  ? "이 폴더 안에 정면·옆모습·뒷모습 등 캐릭터의 여러 모습을 이미지로 모아두면, 프로젝트에 이 캐릭터를 등장시킬 때 모습을 확실하게 전달할 수 있습니다."
                  : "이 폴더 안에 같은 장소·물건·스타일의 여러 참고 이미지를 모아두면, AI 생성 시 폴더 하나로 함께 전달할 수 있습니다."}{" "}
                대표 이미지가 목록·썸네일에 표시됩니다. 아래 폴더 설명(공통 특징)과 각 이미지의 개별 특징이 AI에게 함께 전달됩니다.
              </p>
              {(folderChildrenLoading || referenceSetPending) && <Spinner label="불러오는 중..." />}
              {folderChildrenError && (
                <p role="alert" data-testid="folder-children-error" data-error-code={folderChildrenError.code} className="text-sm text-rose-400">
                  {folderChildrenError.message}
                </p>
              )}
              {folderChildren && folderChildren.length === 0 && !folderChildrenLoading && (
                <p className="text-sm text-slate-400">아직 등록된 이미지가 없습니다. 아래에서 기존 이미지를 검색해 추가해 주세요.</p>
              )}
              {folderChildren && folderChildren.length > 0 && (
                <ol aria-label="순서가 있는 참고 이미지" className="space-y-2">
                  {folderChildren.map((child, index) => (
                    <li key={child.assetId} className="space-y-2 rounded-xl border border-white/10 bg-slate-900/60 p-2.5 text-sm text-slate-300">
                      <div className="flex flex-wrap items-center gap-2">
                        {child.imageAvailable && child.contentUrl && <img src={child.contentUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />}
                        <span className="flex-1">
                          {index + 1}. {child.displayName}
                          {selected.asset.thumbnailAssetId === child.assetId ? " (대표 이미지)" : ""}
                        </span>
                        {selected.asset.assetType === "character" && (
                          <label className="flex items-center gap-1.5 text-xs text-slate-400">
                            역할
                            <select
                              className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
                              value={CHARACTER_ROLE_OPTIONS.some((option) => option.value === child.role) ? child.role : "other"}
                              disabled={folderMutationPending}
                              onChange={(event) => void updateChildRole(child.assetId, event.target.value)}
                            >
                              {CHARACTER_ROLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        <label className="flex min-w-0 flex-1 items-center gap-1.5">
                          개별 특징
                          <input
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
                            placeholder="이 이미지만의 특징 (예: 정면, 웃는 표정)"
                            value={childDescriptionDrafts[child.assetId] ?? child.description}
                            disabled={folderMutationPending}
                            onChange={(event) => {
                              const next = event.target.value;
                              setChildDescriptionDrafts((current) =>
                                next === child.description
                                  ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== child.assetId))
                                  : { ...current, [child.assetId]: next },
                              );
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          data-testid={`child-description-save-${child.assetId}`}
                          className={smallOutlineButton}
                          disabled={folderMutationPending || childDescriptionDrafts[child.assetId] === undefined}
                          onClick={() => void saveChildDescription(child.assetId)}
                        >
                          특징 저장
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={smallOutlineButton} disabled={referenceSetPending || index === 0} onClick={() => moveCharacterReference(child.assetId, -1)}>
                          위로
                        </button>
                        <button type="button" className={smallOutlineButton} disabled={referenceSetPending || index === folderChildren.length - 1} onClick={() => moveCharacterReference(child.assetId, 1)}>
                          아래로
                        </button>
                        <button
                          type="button"
                          className={smallAddButton}
                          disabled={referenceSetPending || selected.asset.thumbnailAssetId === child.assetId}
                          onClick={() => void saveCharacterReferenceSet(selected.asset.childAssetIds, child.assetId)}
                        >
                          대표 이미지로 정하기
                        </button>
                        <button type="button" className={smallRemoveButton} disabled={folderMutationPending} onClick={() => void unlinkAssetFromFolder(child.assetId)}>
                          폴더에서 빼기
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {folderMutationError && (
                <p role="alert" data-testid="folder-mutation-error" data-error-code={folderMutationError.code} className="text-sm text-rose-400">
                  {folderMutationError.message}
                </p>
              )}
              <form onSubmit={submitFolderUpload} aria-label="이 폴더에 새 이미지 등록" className="space-y-2 border-t border-white/10 pt-3">
                <p className="text-sm font-semibold text-slate-200">이 폴더에 새 이미지 등록</p>
                <p className="text-xs text-slate-400">
                  아직 이미지 보관함에 없는 이미지를 바로 이 폴더 안으로 등록합니다. 유형은 이 폴더와 같은 것으로 들어갑니다.
                </p>
                {folderUploadValidationError && (
                  <p role="alert" data-testid="folder-upload-validation-error" className="text-sm text-rose-400">
                    {folderUploadValidationError}
                  </p>
                )}
                <label className="block text-sm text-slate-300">
                  이미지 파일
                  <input
                    key={folderUploadInputGeneration}
                    type="file"
                    accept="image/*"
                    disabled={folderUploadPending}
                    className="mt-1.5 block w-full text-sm text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-slate-200 disabled:opacity-50"
                    onChange={(event) => { setFolderUploadFile(event.target.files?.[0] ?? null); setFolderUploadValidationError(null); }}
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  이름
                  <input
                    value={folderUploadName}
                    disabled={folderUploadPending}
                    className={fieldClassName}
                    onChange={(event) => { setFolderUploadName(event.target.value); setFolderUploadValidationError(null); }}
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  설명
                  <input value={folderUploadDescription} disabled={folderUploadPending} className={fieldClassName} onChange={(event) => setFolderUploadDescription(event.target.value)} />
                </label>
                <button type="submit" disabled={folderUploadPending} className={smallAddButton}>
                  {folderUploadPending ? "등록하는 중…" : "이 폴더에 등록"}
                </button>
              </form>
              <form onSubmit={searchFolderLinkCandidates} aria-label="폴더에 추가할 이미지 검색" className="space-y-2 border-t border-white/10 pt-3">
                <p className="text-sm font-semibold text-slate-200">이미 등록된 이미지 넣기</p>
                <p className="text-xs text-slate-400">이미지 보관함에 이미 등록된 같은 유형의 이미지를 검색해서 이 폴더에 추가할 수 있습니다.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-slate-400">
                    이미지 검색
                    <input className="rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30" value={folderLinkQuery} onChange={(event) => setFolderLinkQuery(event.target.value)} />
                  </label>
                  <button type="submit" className={smallOutlineButton} disabled={folderLinkSearchLoading}>검색</button>
                </div>
                {folderLinkSearchLoading && <Spinner label="검색 중..." />}
                {folderLinkSearchError && (
                  <p role="alert" data-testid="folder-link-search-error" data-error-code={folderLinkSearchError.code} className="text-sm text-rose-400">
                    {folderLinkSearchError.message}
                  </p>
                )}
                {folderLinkResults && (
                  <ul aria-label="추가 가능한 이미지 검색 결과" className="space-y-1">
                    {folderLinkResults
                      .filter((asset) => !asset.isFolder && asset.assetId !== selected.asset.assetId && !selected.asset.childAssetIds.includes(asset.assetId))
                      .map((asset) => (
                        <li key={asset.assetId} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
                          {asset.imageAvailable && asset.contentUrl && <img src={asset.contentUrl} alt="" className="h-8 w-8 rounded-md object-cover" />}
                          <span className="flex-1 text-sm text-slate-200">{asset.displayName}</span>
                          <button type="button" className={smallAddButton} disabled={folderMutationPending} onClick={() => void linkAssetToFolder(asset.assetId)}>
                            폴더에 넣기
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
                {folderLinkResults && folderLinkResults.length === 0 && !folderLinkSearchLoading && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}
              </form>
            </section>
          )}

          <form onSubmit={submitEdit} aria-label="에셋 정보 편집" className="space-y-3 rounded-xl border border-white/10 bg-slate-950/30 p-3.5">
            <label className="block text-sm text-slate-300">
              이름
              <input value={editName} required disabled={editPending} className={fieldClassName} onChange={(event) => setEditName(event.target.value)} />
            </label>
            <label className="block text-sm text-slate-300">
              {selected.asset.isFolder ? "공통 특징(폴더 설명)" : "설명"}
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
                    {selected.asset.version === version.version ? " (현재)" : ""} ·{" "}
                    <span className="tabular-nums" title={version.createdAt}>{formatDateTime(version.createdAt)}</span>
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
              <button type="button" className={dangerOutlineButton} onClick={() => setConfirmAction("delete-asset")} disabled={selected.usageProjectIds.length > 0 || deletePending}>
                목록에서 삭제
              </button>
              {selected.usageProjectIds.length > 0 && <p className="text-sm text-slate-400">사용 중인 에셋은 삭제할 수 없습니다.</p>}
              {selected.canDeleteOwnedFile && (
                <button type="button" className={dangerOutlineButton} onClick={() => setConfirmAction("delete-owned-file")} disabled={ownedFileDeletePending}>
                  에셋과 원본 파일 함께 삭제
                </button>
              )}
            </div>
          )}
          {selected.asset.isFolder && (
            <section aria-label="폴더 삭제" className="space-y-2 rounded-xl border border-rose-400/20 bg-rose-950/10 p-3.5">
              <h4 className="text-sm font-semibold text-slate-200">폴더 삭제</h4>
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
                onClick={() => setConfirmAction("delete-folder")}
                disabled={selected.usageProjectIds.length > 0 || folderDeletePending}
              >
                폴더 삭제
              </button>
              {selected.usageProjectIds.length > 0 && <p className="text-sm text-slate-400">사용 중인 폴더는 삭제할 수 없습니다.</p>}
            </section>
          )}

          {confirmAction && (
            <div
              role="alertdialog"
              aria-label="위험 동작 확인"
              data-testid="asset-confirm-panel"
              className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
            >
              <p className="text-sm text-slate-200">
                {confirmAction === "delete-asset" && `'${selected.asset.displayName}' 에셋을 라이브러리 목록에서 삭제할까요? 원본 파일은 삭제하지 않습니다.`}
                {confirmAction === "relink" && `'${selected.asset.displayName}' 에셋의 현재 버전 파일을 교체할까요?`}
                {confirmAction === "delete-owned-file" && `'${selected.asset.displayName}' 에셋과 원본 이미지 파일을 함께 삭제할까요? 이 작업은 되돌릴 수 없습니다.`}
                {confirmAction === "delete-folder" && (folderDeleteManualFiles
                  ? `'${selected.asset.displayName}' 폴더와 하위 항목, 원본 파일을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
                  : folderRemoveChildIndexes || folderDeleteManualFiles
                    ? `'${selected.asset.displayName}' 폴더와 하위 항목 색인을 삭제할까요? 원본 파일은 삭제하지 않습니다.`
                    : `'${selected.asset.displayName}' 폴더만 삭제할까요? 하위 항목은 목록에 그대로 남습니다.`)}
              </p>
              {confirmError && (
                <p
                  role="alert"
                  data-testid="asset-confirm-error"
                  data-error-code={confirmError.code}
                  className="text-sm text-rose-400"
                >
                  {confirmError.message}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  className={outlineButton}
                  onClick={() => { setConfirmAction(null); setConfirmError(null); }}
                  disabled={confirmPending}
                >
                  {confirmError ? "닫기" : "취소"}
                </button>
                <button
                  type="button"
                  data-testid="asset-confirm-proceed"
                  className={dangerOutlineButton}
                  disabled={confirmPending}
                  onClick={() => {
                    if (confirmAction === "delete-asset") void remove();
                    else if (confirmAction === "relink") void confirmRelink();
                    else if (confirmAction === "delete-owned-file") void removeOwnedFile();
                    else void removeFolder();
                  }}
                >
                  {confirmPending ? "처리 중..." : confirmError ? "다시 시도" : "네, 진행합니다"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      </div>
      </div>
    </section>
  );
}
