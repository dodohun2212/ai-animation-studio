import { useEffect, useRef, useState } from "react";
import type { LongEpisodeContinuityMemory, LongEpisodeDetail, SaveLongEpisodeContinuityRequest } from "@ai-animation-studio/shared";

import { getLongEpisodeContinuity, saveLongEpisodeContinuity, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  onBack: () => void;
  onOpenNextEpisode?: (projectId: string, episodeNumber: number) => void;
}

type DisplayError = { code: string; message: string };
type FormState = Omit<LongEpisodeContinuityMemory, "episodeNumber" | "updatedAt" | "characterChanges" | "itemChanges"> & { characterChanges: string; itemChanges: string };

const listFields = [
  ["events", "Episode events"], ["appearedCharacterIds", "Appeared character IDs"], ["appearedLocationIds", "Appeared location IDs"],
  ["resolvedConflicts", "Resolved conflicts"], ["newConflicts", "New conflicts"], ["revealedSecretIds", "Revealed secret IDs"],
  ["remainingSecretIds", "Remaining secret IDs"], ["newForeshadowingIds", "New foreshadowing IDs"], ["resolvedForeshadowingIds", "Resolved foreshadowing IDs"],
  ["nextActions", "Next Episode actions"], ["worldChanges", "World changes"],
] as const;
type ListKey = (typeof listFields)[number][0];

const blankForm = (): FormState => ({
  episodeSummary: "", events: [], appearedCharacterIds: [], characterChanges: "[]", appearedLocationIds: [], itemChanges: "[]",
  resolvedConflicts: [], newConflicts: [], revealedSecretIds: [], remainingSecretIds: [], newForeshadowingIds: [], resolvedForeshadowingIds: [],
  nextActions: [], timeElapsed: "", worldChanges: [], userEdits: "",
});

const toLines = (value: string[]) => value.join("\n");
const fromLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

function toForm(memory: LongEpisodeContinuityMemory | null): FormState {
  if (!memory) return blankForm();
  const { episodeNumber: _episodeNumber, updatedAt: _updatedAt, characterChanges, itemChanges, ...form } = memory;
  return { ...form, characterChanges: JSON.stringify(characterChanges, null, 2), itemChanges: JSON.stringify(itemChanges, null, 2) };
}

function parseRecordArray(value: string): Array<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "object" && item !== null && !Array.isArray(item)) ? parsed as Array<Record<string, unknown>> : null;
  } catch { return null; }
}

function toRequest(form: FormState): SaveLongEpisodeContinuityRequest | null {
  if (!form.episodeSummary.trim()) return null;
  const characterChanges = parseRecordArray(form.characterChanges);
  const itemChanges = parseRecordArray(form.itemChanges);
  if (!characterChanges || !itemChanges) return null;
  return { memory: { ...form, characterChanges, itemChanges } };
}

/** A user-reviewed, explicit save point before the next Episode is opened. */
export function LongEpisodeContinuityScreen({ projectId, episodeNumber, onBack, onOpenNextEpisode }: Props) {
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [saved, setSaved] = useState<LongEpisodeDetail | null | undefined>(undefined);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setSaved(undefined);
    getLongEpisodeContinuity(projectId, episodeNumber)
      .then((response) => { if (!cancelled) setForm(toForm(response.memory)); })
      .catch((caught) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);

  function update(key: keyof FormState, value: string): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(): Promise<void> {
    const request = toRequest(form);
    if (!request) { setError({ code: "INVALID_REQUEST", message: "Add an Episode summary and use JSON arrays of objects for character and item changes." }); return; }
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const response = await saveLongEpisodeContinuity(projectId, episodeNumber, request);
      setForm(toForm(response.memory));
      setSaved(response.nextEpisode);
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  return <section className="mt-8 space-y-4" data-testid="episode-continuity-screen">
    <button type="button" onClick={onBack}>Back to final Episode video</button>
    <h2>Episode {episodeNumber} continuity memory</h2>
    <p>Review and save these facts explicitly before preparing the next Episode. Opening this screen never saves anything.</p>
    {loading && <Spinner label="Loading saved continuity memory..." />}
    {!loading && <div className="space-y-3">
      <label>Episode summary<textarea data-testid="continuity-summary" value={form.episodeSummary} disabled={pending} onChange={(event) => update("episodeSummary", event.target.value)} /></label>
      {listFields.map(([key, label]) => <label key={key}>{label}<textarea data-testid={`continuity-${key}`} value={toLines(form[key])} disabled={pending} onChange={(event) => setForm((current) => ({ ...current, [key]: fromLines(event.target.value) }))} placeholder="One item per line" /></label>)}
      <label>Character changes (JSON array)<textarea data-testid="continuity-character-changes" value={form.characterChanges} disabled={pending} onChange={(event) => update("characterChanges", event.target.value)} /></label>
      <label>Item changes (JSON array)<textarea data-testid="continuity-item-changes" value={form.itemChanges} disabled={pending} onChange={(event) => update("itemChanges", event.target.value)} /></label>
      <label>Time elapsed<input data-testid="continuity-time-elapsed" value={form.timeElapsed} disabled={pending} onChange={(event) => update("timeElapsed", event.target.value)} /></label>
      <label>User-reviewed notes<textarea data-testid="continuity-user-edits" value={form.userEdits} disabled={pending} onChange={(event) => update("userEdits", event.target.value)} /></label>
      <button type="button" data-testid="continuity-save" disabled={pending} onClick={() => void save()}>{pending ? "Saving continuity..." : "Save reviewed continuity"}</button>
    </div>}
    {saved !== undefined && <div data-testid="continuity-save-success"><p>{saved ? `Episode ${saved.episodeNumber} is available next (${saved.status}).` : "This was the final Episode; no next Episode is available."}</p>{saved && onOpenNextEpisode && <button type="button" data-testid="continuity-open-next-episode" onClick={() => onOpenNextEpisode(projectId, saved.episodeNumber)}>Open Episode {saved.episodeNumber}</button>}</div>}
    {error && <p role="alert" data-testid="continuity-error" data-error-code={error.code}>{error.message}</p>}
  </section>;
}
