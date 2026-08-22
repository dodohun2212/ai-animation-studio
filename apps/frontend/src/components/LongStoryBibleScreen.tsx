import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LongStoryBible, LongStoryBibleCollection, LongStoryBibleItem, LongStoryBibleItemInput } from "@ai-animation-studio/shared";

import { createLongStoryBibleItem, deleteLongStoryBibleItem, getLongProjectStoryBible, toLongStoryBibleDisplayError, updateLongStoryBibleItem } from "../api/longStoryBibleApi.js";

interface Props { projectId: string; onBack: () => void; }
type DisplayError = { code: string; message: string };
const TABS: Array<{ value: LongStoryBibleCollection; label: string }> = [
  { value: "characters", label: "Characters" }, { value: "locations", label: "Locations" }, { value: "props", label: "Props" },
  { value: "secrets", label: "Secrets" }, { value: "foreshadowing", label: "Foreshadowing" },
];

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
  const busy = useRef(false);
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const response = await getLongProjectStoryBible(projectId);
      if (version === loadVersion.current) { setBible(response.storyBible); setError(null); }
    } catch (caught) {
      if (version === loadVersion.current) setError(toLongStoryBibleDisplayError(caught));
    } finally { if (version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [projectId]);

  function resetEditor(): void {
    setName(""); setItemId(""); setDescription(""); setStatus(""); setEditing(null); setValidationError(null);
  }
  function startEdit(item: LongStoryBibleItem): void {
    setEditing(item); setName(item.name ?? ""); setItemId(item.id); setDescription(item.description ?? ""); setStatus(item.status ?? ""); setValidationError(null); setDeleteTarget(null);
  }
  function draft(): LongStoryBibleItemInput {
    return { ...(itemId.trim() ? { id: itemId.trim() } : {}), name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), ...(status.trim() ? { status: status.trim() } : {}) };
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

  return <section className="mt-8 space-y-5">
    <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>Back to project</button>
    <h2 className="text-xl font-semibold">Story Bible</h2>
    <p className="text-sm text-slate-400">Organize this long project's characters and world-building records locally.</p>
    {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    <div role="tablist" aria-label="Story Bible collection" className="flex flex-wrap gap-2">
      {TABS.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={collection === tab.value} onClick={() => { setCollection(tab.value); resetEditor(); setDeleteTarget(null); }} className="rounded-full border border-white/10 px-3 py-1 text-sm">{tab.label}</button>)}
    </div>
    {loading && !bible && <p className="text-slate-400">Loading Story Bible...</p>}
    {bible && items.length === 0 && <p data-testid="story-bible-empty" className="text-slate-400">No {collectionLabel} entries yet.</p>}
    {bible && items.length > 0 && <ul aria-label={`${collectionLabel} list`} className="space-y-2">
      {items.map((item) => <li key={item.id} className="rounded-lg border border-white/10 p-3"><strong>{item.name || item.id}</strong><span className="ml-2 text-xs text-slate-400">{item.id}</span>{item.status && <span className="ml-2 text-xs text-violet-300">{item.status}</span>}{item.description && <p className="mt-1 text-sm text-slate-300">{item.description}</p>}<div className="mt-2 flex gap-2"><button type="button" onClick={() => startEdit(item)}>Edit</button><button type="button" onClick={() => setDeleteTarget(item)} disabled={pending}>Delete</button></div></li>)}
    </ul>}
    <form aria-label={editing ? "Edit Story Bible item" : "Add Story Bible item"} onSubmit={(event) => void submit(event)} className="space-y-3 rounded-lg border border-violet-400/30 p-4">
      <h3 className="font-semibold">{editing ? "Edit item" : "Add item"}</h3>
      {validationError && <p role="alert" data-testid="story-bible-validation-error" className="text-sm text-rose-400">{validationError}</p>}
      <label className="block text-sm">ID (optional)<input aria-label="Item ID" value={itemId} disabled={pending || Boolean(editing)} onChange={(event) => setItemId(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      <label className="block text-sm">Name<input aria-label="Item name" value={name} disabled={pending} onChange={(event) => { setName(event.target.value); setValidationError(null); }} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      <label className="block text-sm">Description<textarea aria-label="Item description" value={description} disabled={pending} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      <label className="block text-sm">Status<input aria-label="Item status" value={status} disabled={pending} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" /></label>
      <div className="flex gap-2"><button type="submit" disabled={pending}>{pending ? "Saving..." : editing ? "Save changes" : "Add item"}</button>{editing && <button type="button" onClick={resetEditor} disabled={pending}>Cancel</button>}</div>
    </form>
    {deleteTarget && <div role="alertdialog" aria-label="Confirm Story Bible item deletion" className="rounded-lg border border-amber-400/40 p-4"><p>Delete {deleteTarget.name || deleteTarget.id}?</p><p className="mt-1 text-sm text-slate-400">This separate final confirmation is required before deletion.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setDeleteTarget(null)} disabled={pending}>Cancel</button><button type="button" onClick={() => void confirmDelete()} disabled={pending}>{pending ? "Deleting..." : "Confirm delete"}</button></div></div>}
  </section>;
}
