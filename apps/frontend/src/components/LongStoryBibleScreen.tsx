import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Asset, LongStoryBible, LongStoryBibleAssetLink, LongStoryBibleCollection, LongStoryBibleItem, LongStoryBibleItemInput, LongStoryBibleRelationshipIssue, LongStoryBibleStyleAssetLink } from "@ai-animation-studio/shared";

import { createLongStoryBibleItem, deleteLongStoryBibleItem, duplicateLongStoryBibleItem, getLongProjectStoryBible, getLongStoryBibleRelationshipAudit, searchLongStoryBibleItems, toLongStoryBibleDisplayError, updateLongStoryBibleContent, updateLongStoryBibleItem, updateLongStoryBibleStyleAssetLink } from "../api/longStoryBibleApi.js";
import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { getLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";

interface Props { projectId: string; onBack: () => void; }
type DisplayError = { code: string; message: string };
const TABS: Array<{ value: LongStoryBibleCollection; label: string }> = [
  { value: "characters", label: "Characters" }, { value: "locations", label: "Locations" }, { value: "props", label: "Props" },
  { value: "secrets", label: "Secrets" }, { value: "foreshadowing", label: "Foreshadowing" },
];
const ASSET_LINK_COLLECTIONS: readonly LongStoryBibleCollection[] = ["characters", "locations", "props"];

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
    } catch { setContentValidationError(`${label} must be a JSON object.`); return null; }
  }
  async function saveContent(): Promise<void> {
    if (busy.current) return;
    const basic = parseContentDraft(basicDraft, "Basic settings");
    const world = parseContentDraft(worldDraft, "World settings");
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
    if (styleAssetId && !asset) { setContentValidationError("Select an available style Asset Library asset."); return; }
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
    if (!name.trim()) { setValidationError("Name is required."); return; }
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

  return <section className="mt-8 space-y-5">
    <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>Back to project</button>
    <h2 className="text-xl font-semibold">Story Bible</h2>
    <p className="text-sm text-slate-400">Organize this long project's characters and world-building records locally.</p>
    {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    <section aria-label="Story Bible basic and world settings" className="space-y-3 rounded-lg border border-white/10 p-4">
      <div><h3 className="font-semibold">Basic and world settings</h3><p className="text-sm text-slate-400">Edit the local JSON objects used as Story Bible context. Saving does not generate scripts, images, or videos.</p></div>
      {contentValidationError && <p role="alert" data-testid="story-bible-content-validation-error" className="text-sm text-rose-400">{contentValidationError}</p>}
      <label className="block text-sm">Basic settings JSON<textarea aria-label="Basic settings JSON" value={basicDraft} disabled={pending} onChange={(event) => { setBasicDraft(event.target.value); setContentValidationError(null); }} className="mt-1 min-h-28 w-full rounded border border-white/10 bg-slate-800 px-3 py-2 font-mono text-xs" /></label>
      <label className="block text-sm">World settings JSON<textarea aria-label="World settings JSON" value={worldDraft} disabled={pending} onChange={(event) => { setWorldDraft(event.target.value); setContentValidationError(null); }} className="mt-1 min-h-28 w-full rounded border border-white/10 bg-slate-800 px-3 py-2 font-mono text-xs" /></label>
      <button type="button" onClick={() => void saveContent()} disabled={pending}>{pending ? "Saving..." : "Save basic and world settings"}</button>
    </section>
    <section aria-label="Global visual style Asset Library link" className="space-y-3 rounded-lg border border-white/10 p-4">
      <div><h3 className="font-semibold">Global visual style</h3><p className="text-sm text-slate-400">Optionally link one approved style asset for this whole project.</p></div>
      {assetLoading && <p className="text-sm text-slate-400">Loading usable style assets...</p>}
      {!assetLoading && styleAssets.length === 0 && <p className="text-sm text-slate-400">No approved, enabled style assets are available.</p>}
      <label className="block text-sm">Style Asset<select aria-label="Global style Asset" value={styleAssetId} disabled={pending || assetLoading} onChange={(event) => setStyleAssetId(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2"><option value="">No global style asset</option>{styleAssets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.displayName} ({asset.assetId}) 쨌 v{asset.version}</option>)}</select></label>
      {styleAssetId && <label className="block text-sm">Style version policy<select aria-label="Global style version policy" value={styleVersionPolicy} disabled={pending} onChange={(event) => setStyleVersionPolicy(event.target.value as LongStoryBibleStyleAssetLink["versionPolicy"])} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2"><option value="pinned_version">Pin current version</option><option value="follow_latest">Follow latest version</option><option value="snapshot">Snapshot current version</option></select></label>}
      {bible?.styleAssetLink && <p data-testid="global-style-asset-link" className="text-sm text-emerald-300">Linked style: {bible.styleAssetLink.assetId} 쨌 {bible.styleAssetLink.versionPolicy} 쨌 v{bible.styleAssetLink.pinnedVersion}</p>}
      <button type="button" onClick={() => void saveStyleAssetLink()} disabled={pending || assetLoading}>{pending ? "Saving..." : styleAssetId ? "Save global style" : "Remove global style"}</button>
    </section>
    <section aria-label="Story Bible relationship audit" className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Relationship audit</h3><p className="text-sm text-slate-400">Read-only check for missing Story Bible links.</p></div><button type="button" onClick={() => void loadRelationshipAudit()} disabled={relationshipAuditLoading}>{relationshipAuditLoading ? "Checking..." : relationshipAudit === null ? "Check relationships" : "Refresh audit"}</button></div>
      {relationshipAuditLoading && <p className="mt-3 text-sm text-slate-400">Checking Story Bible relationships...</p>}
      {relationshipAuditError && <div className="mt-3"><p role="alert" data-error-code={relationshipAuditError.code} className="text-sm text-rose-400">{relationshipAuditError.message}</p><button type="button" className="mt-2" onClick={() => void loadRelationshipAudit()} disabled={relationshipAuditLoading}>Retry audit</button></div>}
      {relationshipAudit && relationshipAudit.length === 0 && <p data-testid="relationship-audit-healthy" className="mt-3 text-sm text-emerald-300">All Story Bible relationships are healthy.</p>}
      {relationshipAudit && relationshipAudit.length > 0 && <ul aria-label="Relationship audit issues" className="mt-3 space-y-2">{relationshipAudit.map((issue, index) => <li key={`${issue.collection}-${issue.itemId}-${issue.field}-${index}`} className="rounded border border-amber-400/30 p-2 text-sm"><strong>{issue.collection}</strong> / {issue.itemId} / {issue.field}: missing {issue.missingIds.join(", ")}</li>)}</ul>}
    </section>
    <div role="tablist" aria-label="Story Bible collection" className="flex flex-wrap gap-2">
      {TABS.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={collection === tab.value} onClick={() => { setCollection(tab.value); resetEditor(); setDeleteTarget(null); setSearchQuery(""); setSearchResults(null); setSearchError(null); setDuplicateError(null); }} className="rounded-full border border-white/10 px-3 py-1 text-sm">{tab.label}</button>)}
    </div>
    <section aria-label={`${collectionLabel} search`} className="rounded-lg border border-white/10 p-4">
      <h3 className="font-semibold">Search {collectionLabel}</h3>
      <p className="mt-1 text-sm text-slate-400">Search this collection only. No search runs until you submit a query.</p>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="sr-only" htmlFor="story-bible-search">Search {collectionLabel}</label>
        <input id="story-bible-search" aria-label={`Search ${collectionLabel}`} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="rounded border border-white/10 bg-slate-800 px-3 py-2" />
        <button type="submit" disabled={searchLoading || !searchQuery.trim()}>{searchLoading ? "Searching..." : "Search"}</button>
      </form>
      {searchError && <div className="mt-3"><p role="alert" data-error-code={searchError.code} className="text-sm text-rose-400">{searchError.message}</p><button type="button" className="mt-2" onClick={() => void search()} disabled={searchLoading}>Retry search</button></div>}
      {searchResults && searchResults.length === 0 && <p data-testid="story-bible-search-empty" className="mt-3 text-sm text-slate-400">No matching {collectionLabel} entries.</p>}
      {searchResults && searchResults.length > 0 && <ul aria-label={`${collectionLabel} search results`} className="mt-3 space-y-2">{searchResults.map((item) => <li key={item.id} className="rounded border border-white/10 p-2 text-sm"><strong>{item.name || item.id}</strong><span className="ml-2 text-slate-400">{item.id}</span><button type="button" className="ml-3" onClick={() => void duplicate(item)} disabled={Boolean(duplicatingId) || pending}>{duplicatingId === item.id ? "Duplicating..." : "Duplicate"}</button></li>)}</ul>}
      {duplicateError && <p role="alert" data-error-code={duplicateError.code} className="mt-3 text-sm text-rose-400">{duplicateError.message}</p>}
    </section>
    {loading && !bible && <p className="text-slate-400">Loading Story Bible...</p>}
    {bible && items.length === 0 && <p data-testid="story-bible-empty" className="text-slate-400">No {collectionLabel} entries yet.</p>}
    {bible && items.length > 0 && <ul aria-label={`${collectionLabel} list`} className="space-y-2">
      {items.map((item) => <li key={item.id} className="rounded-lg border border-white/10 p-3"><strong>{item.name || item.id}</strong><span className="ml-2 text-xs text-slate-400">{item.id}</span>{item.status && <span className="ml-2 text-xs text-violet-300">{item.status}</span>}{item.description && <p className="mt-1 text-sm text-slate-300">{item.description}</p>}{item.assetLink && <p data-testid={`asset-link-${item.id}`} className="mt-1 text-sm text-emerald-300">Asset: {item.assetLink.assetId} · {item.assetLink.versionPolicy === "pinned_version" ? `pinned v${item.assetLink.pinnedVersion}` : "follow latest"} · {item.assetLink.episodeScope.mode === "all" ? "all episodes" : `Episode ${item.assetLink.episodeScope.episode}`}</p>}<div className="mt-2 flex gap-2"><button type="button" onClick={() => startEdit(item)}>Edit</button><button type="button" onClick={() => void duplicate(item)} disabled={Boolean(duplicatingId) || pending}>{duplicatingId === item.id ? "Duplicating..." : "Duplicate"}</button><button type="button" onClick={() => setDeleteTarget(item)} disabled={pending}>Delete</button></div></li>)}
    </ul>}
    <form aria-label={editing ? "Edit Story Bible item" : "Add Story Bible item"} onSubmit={(event) => void submit(event)} className="space-y-3 rounded-lg border border-violet-400/30 p-4">
      <h3 className="font-semibold">{editing ? "Edit item" : "Add item"}</h3>
      {validationError && <p role="alert" data-testid="story-bible-validation-error" className="text-sm text-rose-400">{validationError}</p>}
      <label className="block text-sm">ID (optional)<input aria-label="Item ID" value={itemId} disabled={pending || Boolean(editing)} onChange={(event) => setItemId(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      <label className="block text-sm">Name<input aria-label="Item name" value={name} disabled={pending} onChange={(event) => { setName(event.target.value); setValidationError(null); }} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      <label className="block text-sm">Description<textarea aria-label="Item description" value={description} disabled={pending} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      <label className="block text-sm">Status<input aria-label="Item status" value={status} disabled={pending} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      {supportsAssetLink && <fieldset className="space-y-3 rounded border border-white/10 p-3" disabled={pending || assetLoading}>
        <legend className="px-1 text-sm">Asset Library link (optional)</legend>
        {assetLoading && <p className="text-sm text-slate-400">Loading usable assets...</p>}
        {!assetLoading && assets.length === 0 && <p className="text-sm text-slate-400">No approved, enabled Asset Library assets are available.</p>}
        <label className="block text-sm">Asset<select aria-label="Linked Asset" value={assetId} onChange={(event) => setAssetId(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2"><option value="">No Asset Library link</option>{assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.displayName} ({asset.assetId}) · v{asset.version}</option>)}</select></label>
        {assetId && <><label className="block text-sm">Version policy<select aria-label="Asset version policy" value={versionPolicy} onChange={(event) => setVersionPolicy(event.target.value as LongStoryBibleAssetLink["versionPolicy"])} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2"><option value="pinned_version">Pin current version</option><option value="follow_latest">Follow latest version</option></select></label>
          <label className="block text-sm">Episode scope<select aria-label="Asset episode scope" value={scopeMode} onChange={(event) => setScopeMode(event.target.value as "all" | "episode")} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2"><option value="all">All episodes</option><option value="episode">One episode</option></select></label>
          {scopeMode === "episode" && <label className="block text-sm">Episode number<select aria-label="Asset episode number" value={scopeEpisode} onChange={(event) => setScopeEpisode(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2">{Array.from({ length: episodeCount ?? 0 }, (_, index) => <option key={index + 1} value={index + 1}>Episode {index + 1}</option>)}</select></label>}</>}
      </fieldset>}
      <div className="flex gap-2"><button type="submit" disabled={pending}>{pending ? "Saving..." : editing ? "Save changes" : "Add item"}</button>{editing && <button type="button" onClick={resetEditor} disabled={pending}>Cancel</button>}</div>
    </form>
    {deleteTarget && <div role="alertdialog" aria-label="Confirm Story Bible item deletion" className="rounded-lg border border-amber-400/40 p-4"><p>Delete {deleteTarget.name || deleteTarget.id}?</p><p className="mt-1 text-sm text-slate-400">This separate final confirmation is required before deletion.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setDeleteTarget(null)} disabled={pending}>Cancel</button><button type="button" onClick={() => void confirmDelete()} disabled={pending}>{pending ? "Deleting..." : "Confirm delete"}</button></div></div>}
  </section>;
}
