import { useEffect, useMemo, useState } from "react";
import type { LongEpisodeStatus, LongProject } from "@ai-animation-studio/shared";

import { addLongEpisode, archiveLongEpisode, archiveLongProject, duplicateLongEpisode, getLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { ArchiveProjectDialog } from "./ArchiveProjectDialog.js";
import { Spinner } from "./Spinner.js";

interface LongProjectDetailProps {
  projectId: string; onBack: () => void; onOpenSettings: (projectId: string) => void; onOpenOutline: (projectId: string) => void;
  onOpenStoryBible?: (projectId: string) => void;
  onOpenEpisodeScript?: (projectId: string, episodeNumber: number) => void;
  onOpenMappingReview?: (projectId: string, episodeNumber: number) => void;
  onOpenImageGeneration?: (projectId: string, episodeNumber: number) => void;
  onOpenVideoWorkflow?: (projectId: string, episodeNumber: number) => void;
  onOpenVideoMerge?: (projectId: string, episodeNumber: number) => void;
  onOpenContinuity?: (projectId: string, episodeNumber: number) => void;
  onOpenGallery?: (projectId: string) => void;
  onArchived?: () => void;
}
type DetailState = { status: "loading" } | { status: "error"; error: { code: string; message: string } } | { status: "success"; project: LongProject };

type EpisodeResumeTarget =
  | { screen: "script"; label: string } | { screen: "mappingReview"; label: string } | { screen: "imageGeneration"; label: string }
  | { screen: "videoWorkflow"; label: string } | { screen: "videoMerge"; label: string } | { screen: "continuity"; label: string };

const secondaryButton = "rounded-full border border-violet-400/30 px-4 py-2 text-sm text-violet-300 hover:bg-violet-500/10";
const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const fieldClassName =
  "rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

/** Maps an Episode's current status to the single screen that continues it, matching the long-project fixed flow. */
function episodeResumeTarget(status: LongEpisodeStatus): EpisodeResumeTarget | null {
  switch (status) {
    case "outline_ready": case "script_review": return { screen: "script", label: "대본 작성/편집" };
    case "script_approved": case "waiting_for_asset_mapping_review": return { screen: "mappingReview", label: "Asset Mapping 검토" };
    case "asset_mapping_approved": case "generating_images": case "images_ready": case "images_review": return { screen: "imageGeneration", label: "이미지 생성/검토" };
    case "waiting_for_video_confirmation": case "videos_generating": case "videos_ready": case "videos_review": case "interrupted": return { screen: "videoWorkflow", label: "영상 생성/검토" };
    case "videos_approved": case "rendering": case "failed": return { screen: "videoMerge", label: "최종 영상 병합" };
    case "completed": return { screen: "continuity", label: "Continuity Memory" };
    default: return null; // "planned" has no script yet
  }
}

export function LongProjectDetail({
  projectId, onBack, onOpenSettings, onOpenOutline, onOpenStoryBible, onOpenEpisodeScript,
  onOpenMappingReview = () => {}, onOpenImageGeneration = () => {}, onOpenVideoWorkflow = () => {},
  onOpenVideoMerge = () => {}, onOpenContinuity = () => {}, onOpenGallery = () => {}, onArchived = () => {},
}: LongProjectDetailProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [query, setQuery] = useState(""); const [statusFilter, setStatusFilter] = useState("all");
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(null);
  const [timelinePending, setTimelinePending] = useState(false);
  const [timelineError, setTimelineError] = useState<{ code: string; message: string } | null>(null);
  const [removeConfirmationOpen, setRemoveConfirmationOpen] = useState(false); const [removeConfirmation, setRemoveConfirmation] = useState("");

  useEffect(() => { let cancelled = false; setState({ status: "loading" }); getLongProject(projectId).then((response) => { if (!cancelled) setState({ status: "success", project: response.project }); }).catch((error: unknown) => { if (!cancelled) setState({ status: "error", error: toLongProjectDisplayError(error) }); }); return () => { cancelled = true; }; }, [projectId]);
  const selectedEpisode = state.status === "success" ? state.project.episodes.find((episode) => episode.episodeNumber === selectedEpisodeNumber) ?? null : null;
  const editableTimeline = state.status === "success" && state.project.episodes.every((episode) => episode.status === "planned" || episode.status === "outline_ready");
  const filteredEpisodes = useMemo(() => { if (state.status !== "success") return []; const needle = query.trim().toLocaleLowerCase(); return state.project.episodes.filter((episode) => (statusFilter === "all" || episode.status === statusFilter) && (!needle || `${episode.episodeNumber} ${episode.title} ${episode.summary}`.toLocaleLowerCase().includes(needle))); }, [query, state, statusFilter]);
  async function updateTimeline(action: () => Promise<{ project: LongProject }>, select?: number): Promise<void> { if (timelinePending) return; setTimelinePending(true); setTimelineError(null); try { const result = await action(); setState({ status: "success", project: result.project }); setSelectedEpisodeNumber(select ?? null); setRemoveConfirmationOpen(false); setRemoveConfirmation(""); } catch (error: unknown) { setTimelineError(toLongProjectDisplayError(error)); } finally { setTimelinePending(false); } }
  function resumeEpisode(target: EpisodeResumeTarget, episodeNumber: number): void {
    if (target.screen === "script") onOpenEpisodeScript?.(projectId, episodeNumber);
    else if (target.screen === "mappingReview") onOpenMappingReview(projectId, episodeNumber);
    else if (target.screen === "imageGeneration") onOpenImageGeneration(projectId, episodeNumber);
    else if (target.screen === "videoWorkflow") onOpenVideoWorkflow(projectId, episodeNumber);
    else if (target.screen === "videoMerge") onOpenVideoMerge(projectId, episodeNumber);
    else onOpenContinuity(projectId, episodeNumber);
  }

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>목록으로</button>
      {state.status === "loading" && <Spinner label="Loading..." className="mt-4" />}
      {state.status === "error" && <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>{state.error.message}</p>}
      {state.status === "success" && (
        <>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButton} onClick={() => onOpenSettings(projectId)}>장기 프로젝트 설정</button>
            <button type="button" className={secondaryButton} onClick={() => onOpenOutline(projectId)}>아웃라인 확인</button>
            {onOpenStoryBible && <button type="button" className={secondaryButton} onClick={() => onOpenStoryBible(projectId)}>Story Bible</button>}
            <button type="button" className={secondaryButton} onClick={() => onOpenGallery(projectId)}>생성 이미지 모음</button>
            <button
              type="button"
              className="rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
              onClick={() => setArchiveOpen(true)}
            >
              Archive project
            </button>
          </div>
          {archiveOpen && (
            <ArchiveProjectDialog
              confirmationText={state.project.title}
              projectKind="long"
              onCancel={() => setArchiveOpen(false)}
              onConfirm={async (confirmation) => { await archiveLongProject(projectId, { confirmation }); onArchived(); }}
            />
          )}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-100 sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">ID</dt><dd className="mt-0.5">{state.project.id}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">Title</dt><dd className="mt-0.5">{state.project.title}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-slate-400">Logline</dt><dd className="mt-0.5">{state.project.logline}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">Outline status</dt><dd className="mt-0.5" data-testid="outline-status">{state.project.outlineStatus}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">Episode count</dt><dd className="mt-0.5">{state.project.episodeCount}</dd></div>
          </dl>
          <div data-testid="episode-list" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-200">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
              />
              Episode timeline
            </h3>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Search episodes"
                className={fieldClassName}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search episodes"
              />
              <select aria-label="Filter episode status" className={fieldClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                {[...new Set(state.project.episodes.map((episode) => episode.status))].sort().map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Episode timeline actions">
              <button
                type="button"
                className={outlineButton}
                onClick={() => void updateTimeline(() => addLongEpisode(projectId), state.project.episodes.length + 1)}
                disabled={!editableTimeline || timelinePending}
              >
                Add Episode
              </button>
              <button
                type="button"
                className={outlineButton}
                onClick={() => selectedEpisode && void updateTimeline(() => duplicateLongEpisode(projectId, selectedEpisode.episodeNumber), state.project.episodes.length + 1)}
                disabled={!editableTimeline || !selectedEpisode || timelinePending}
              >
                Duplicate selected
              </button>
              <button
                type="button"
                className={outlineButton}
                onClick={() => { setRemoveConfirmationOpen(true); setRemoveConfirmation(""); }}
                disabled={!editableTimeline || !selectedEpisode || selectedEpisode.episodeNumber !== state.project.episodes.length || timelinePending}
              >
                Archive selected
              </button>
            </div>
            {!editableTimeline && <p className="text-sm text-slate-400">Timeline edits are available only before script or media work starts.</p>}
            {timelineError && <p className="text-sm text-rose-400" role="alert" data-error-code={timelineError.code}>{timelineError.message}</p>}
            {removeConfirmationOpen && selectedEpisode && (
              <section className="rounded-xl border border-rose-400/30 bg-rose-950/20 p-4" aria-label="Episode archive confirmation">
                <p className="text-sm text-slate-300">
                  This recoverably archives Episode {selectedEpisode.episodeNumber}. Type <strong className="text-slate-100">ARCHIVE EPISODE {selectedEpisode.episodeNumber}</strong> to continue.
                </p>
                <label className="mt-3 block text-sm text-slate-200" htmlFor="episode-archive-confirmation">Exact confirmation</label>
                <input
                  id="episode-archive-confirmation"
                  className={`mt-1.5 w-full ${fieldClassName}`}
                  value={removeConfirmation}
                  onChange={(event) => setRemoveConfirmation(event.target.value)}
                  disabled={timelinePending}
                />
                <div className="mt-3 flex gap-2">
                  <button type="button" className={outlineButton} onClick={() => setRemoveConfirmationOpen(false)} disabled={timelinePending}>Cancel</button>
                  <button
                    type="button"
                    className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={() => void updateTimeline(() => archiveLongEpisode(projectId, selectedEpisode.episodeNumber))}
                    disabled={timelinePending || removeConfirmation !== `ARCHIVE EPISODE ${selectedEpisode.episodeNumber}`}
                  >
                    Confirm archive
                  </button>
                </div>
              </section>
            )}
            <ol className="space-y-1.5 text-sm text-slate-300">
              {filteredEpisodes.map((episode) => {
                const target = episodeResumeTarget(episode.status);
                const showResume = target && (target.screen !== "script" || onOpenEpisodeScript);
                const selected = selectedEpisodeNumber === episode.episodeNumber;
                return (
                  <li
                    key={episode.episodeNumber}
                    data-testid={`episode-${episode.episodeNumber}`}
                    data-status={episode.status}
                    data-selected={selected ? "true" : "false"}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 ${selected ? "border-violet-400/40 bg-violet-500/10" : "border-white/10 bg-slate-950/40"}`}
                  >
                    <button
                      type="button"
                      className="text-left font-medium text-slate-100"
                      onClick={() => setSelectedEpisodeNumber(episode.episodeNumber)}
                      aria-pressed={selected}
                    >
                      {episode.episodeNumber}. {episode.title}
                    </button>
                    <span className={episode.status === "outline_ready" ? "text-emerald-400" : "text-slate-400"}>{episode.status}</span>
                    {showResume && (
                      <button type="button" className="ml-auto text-violet-300 hover:text-violet-200" onClick={() => resumeEpisode(target, episode.episodeNumber)}>
                        {target.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            {!filteredEpisodes.length && <p className="text-sm text-slate-400">No Episodes match this filter.</p>}
          </div>
        </>
      )}
    </section>
  );
}
