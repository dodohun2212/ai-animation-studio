import { useEffect, useMemo, useRef, useState } from "react";
import type { ArchivedLongEpisodeSummary, LongEpisodeStatus, LongProject } from "@ai-animation-studio/shared";

import { addLongEpisode, archiveLongEpisode, archiveLongProject, duplicateLongEpisode, getLongProject, listLongEpisodeArchives, restoreLongEpisode, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";
import { ArchiveProjectDialog } from "./ArchiveProjectDialog.js";
import { Spinner } from "./Spinner.js";

interface LongProjectDetailProps {
  projectId: string; onBack: () => void; onOpenSettings: (projectId: string) => void; onOpenOutline: (projectId: string) => void;
  onOpenEpisodeOutline?: (projectId: string, episodeNumber: number) => void;
  onOpenEpisodeScript?: (projectId: string, episodeNumber: number) => void;
  onOpenMappingReview?: (projectId: string, episodeNumber: number) => void;
  onOpenImageGeneration?: (projectId: string, episodeNumber: number) => void;
  onOpenVideoWorkflow?: (projectId: string, episodeNumber: number) => void;
  onOpenVideoMerge?: (projectId: string, episodeNumber: number) => void;
  onOpenContinuity?: (projectId: string, episodeNumber: number) => void;
  onOpenNarrationReview?: (projectId: string, episodeNumber: number) => void;
  onOpenGallery?: (projectId: string) => void;
  onArchived?: () => void;
}
type DetailState = { status: "loading" } | { status: "error"; error: { code: string; message: string } } | { status: "success"; project: LongProject };

type EpisodeResumeTarget =
  | { screen: "script"; label: string } | { screen: "mappingReview"; label: string } | { screen: "imageGeneration"; label: string }
  | { screen: "videoWorkflow"; label: string } | { screen: "videoMerge"; label: string } | { screen: "continuity"; label: string }
  | { screen: "episodeOutline"; label: string };

const secondaryButton = "rounded-full border border-violet-400/30 px-4 py-2 text-sm text-violet-300 hover:bg-violet-500/10";
const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const amberButton = "rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-400 disabled:opacity-50";
/** Short local date, or the raw value when it will not parse — never a guessed time. */
function dateLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString("ko-KR", { dateStyle: "short" });
}
const fieldClassName =
  "rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

/** Maps an Episode's current status to the single screen that continues it, matching the long-project fixed flow. */
function episodeResumeTarget(status: LongEpisodeStatus): EpisodeResumeTarget | null {
  switch (status) {
    case "outline_ready": case "script_review": return { screen: "script", label: "대본 작성/편집" };
    case "script_approved": case "waiting_for_asset_mapping_review": return { screen: "mappingReview", label: "참고 이미지 연결 검토" };
    case "asset_mapping_approved": case "generating_images": case "images_ready": case "images_review": return { screen: "imageGeneration", label: "이미지 생성/검토" };
    case "waiting_for_video_confirmation": case "videos_generating": case "videos_ready": case "videos_review": case "interrupted": return { screen: "videoWorkflow", label: "영상 생성/검토" };
    case "videos_approved": case "rendering": case "failed": return { screen: "videoMerge", label: "최종 영상 병합" };
    case "completed": return { screen: "continuity", label: "이어쓰기 메모" };
    // "planned" has no script yet, but it does have a plan to write — before this screen existed it was the one
    // status with no link at all, which read as "this episode is broken" rather than "this episode is next".
    case "planned": return { screen: "episodeOutline", label: "이 회차 내용 적기" };
    default: return null;
  }
}

/**
 * How many Episodes have reached each stage — the panel Python showed permanently on the long-project screen
 * (`app/ui.py`'s inspector: 전체 에피소드 / 개요 완료 / 대본 완료 / 이미지 완료 / 영상 생성 확인 대기 / 프로젝트 완료).
 *
 * Each count is cumulative on purpose, matching Python: an Episode whose videos are done has also finished its
 * script, so it counts toward 대본 완료 too. The alternative — counting only the current stage — makes the
 * numbers drop as work progresses, which reads as regression. With twenty Episodes this panel is the
 * difference between knowing where the project stands and scrolling a list to count by eye.
 */
const AFTER_OUTLINE = new Set<LongEpisodeStatus>(["outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed"]);
const AFTER_SCRIPT = new Set<LongEpisodeStatus>(["script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed"]);
const AFTER_IMAGES = new Set<LongEpisodeStatus>(["waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed"]);

function episodeStageCounts(episodes: { status: LongEpisodeStatus }[]): { label: string; value: number; highlight?: boolean }[] {
  const count = (predicate: (status: LongEpisodeStatus) => boolean) => episodes.filter((episode) => predicate(episode.status)).length;
  const waiting = count((status) => status === "waiting_for_video_confirmation");
  return [
    { label: "전체 에피소드", value: episodes.length },
    { label: "개요 완료", value: count((status) => AFTER_OUTLINE.has(status)) },
    { label: "대본 완료", value: count((status) => AFTER_SCRIPT.has(status)) },
    { label: "이미지 완료", value: count((status) => AFTER_IMAGES.has(status)) },
    // The only row that is a call to action rather than a tally — coloured when it is not zero.
    { label: "영상 생성 확인 대기", value: waiting, highlight: waiting > 0 },
    { label: "프로젝트 완료", value: count((status) => status === "completed") },
  ];
}

/**
 * Whether this Episode already has a script, and therefore sentences to narrate. The two excluded statuses are
 * the only ones reached before a script exists; the backend's own gate is the same condition (it answers
 * LONG_EPISODE_NARRATION_NOT_ALLOWED otherwise), so this only avoids offering a link that would fail.
 */
function episodeHasScript(status: LongEpisodeStatus): boolean {
  return status !== "planned" && status !== "outline_ready";
}

export function LongProjectDetail({
  projectId, onBack, onOpenSettings, onOpenOutline, onOpenEpisodeOutline, onOpenEpisodeScript,
  onOpenMappingReview = () => {}, onOpenImageGeneration = () => {}, onOpenVideoWorkflow = () => {},
  onOpenVideoMerge = () => {}, onOpenContinuity = () => {}, onOpenNarrationReview = () => {}, onOpenGallery = () => {}, onArchived = () => {},
}: LongProjectDetailProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [query, setQuery] = useState(""); const [statusFilter, setStatusFilter] = useState("all");
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(null);
  const [timelinePending, setTimelinePending] = useState(false);
  const [timelineError, setTimelineError] = useState<{ code: string; message: string } | null>(null);
  const [removeConfirmationOpen, setRemoveConfirmationOpen] = useState(false); const [removeConfirmation, setRemoveConfirmation] = useState("");
  /**
   * The Episodes this project has archived.
   *
   * `null` while unread and after a failed read — never `[]`, because the two mean different things here. The
   * server skips an archive whose own file will not parse, so a short list is not proof of a short shelf, and
   * an empty one is "nothing to show" rather than "you have never archived anything".
   */
  const [archives, setArchives] = useState<ArchivedLongEpisodeSummary[] | null>(null);
  const [archivesError, setArchivesError] = useState<{ code: string; message: string } | null>(null);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [restorePending, setRestorePending] = useState(false);
  /** The number an Episode actually came back as, which is rarely the number it left from. */
  const [restoredAs, setRestoredAs] = useState<{ title: string; episodeNumber: number } | null>(null);

  useEffect(() => { let cancelled = false; setState({ status: "loading" }); getLongProject(projectId).then((response) => { if (!cancelled) setState({ status: "success", project: response.project }); }).catch((error: unknown) => { if (!cancelled) setState({ status: "error", error: toLongProjectDisplayError(error) }); }); return () => { cancelled = true; }; }, [projectId]);
  /* Asked when the shelf is opened, not on arrival. Free and provider-free either way — listing restores
     nothing — but most visits to this screen are not looking for an archived Episode, and the archive
     confirmation now names this section by title, so it is found by being named rather than by being loaded. */
  const archivesRequested = useRef(false);
  function loadArchives(): void {
    if (archivesRequested.current) return;
    archivesRequested.current = true;
    listLongEpisodeArchives(projectId)
      .then((response) => setArchives(response.archives))
      .catch((error: unknown) => setArchivesError(toLongProjectDisplayError(error)));
  }
  useEffect(() => {
    archivesRequested.current = false;
    setArchives(null); setArchivesError(null); setRestoredAs(null); setRestoreConfirmId(null);
  }, [projectId]);

  async function restore(archive: ArchivedLongEpisodeSummary): Promise<void> {
    if (restorePending) return;
    setRestorePending(true); setArchivesError(null);
    try {
      const result = await restoreLongEpisode(projectId, archive.archiveId);
      // Both halves come from the response: the timeline it actually produced, and the number it actually
      // landed on. Working either out from what the screen held would be a second opinion about a move the
      // server just made.
      setState({ status: "success", project: result.project });
      setRestoredAs({ title: result.episode.title, episodeNumber: result.episode.episodeNumber });
      setSelectedEpisodeNumber(result.episode.episodeNumber);
      setArchives((current) => current?.filter((item) => item.archiveId !== archive.archiveId) ?? null);
      setRestoreConfirmId(null);
    } catch (error: unknown) {
      setArchivesError(toLongProjectDisplayError(error));
    } finally { setRestorePending(false); }
  }

  const selectedEpisode = state.status === "success" ? state.project.episodes.find((episode) => episode.episodeNumber === selectedEpisodeNumber) ?? null : null;
  const editableTimeline = state.status === "success" && state.project.episodes.every((episode) => episode.status === "planned" || episode.status === "outline_ready");
  /**
   * True when this project's Episode narration sentences are used for anything — spoken, burned in as
   * subtitles, or both. False while both settings are off, which is the default for every project made before
   * narration existed.
   */
  /** The only episode the backend lets you archive — stated once so the button and its reason cannot drift. */
  const lastEpisodeNumber = state.status === "success" ? state.project.episodes.length : 0;
  const narrationInUse = state.status === "success" && (state.project.settings.narrationEnabled || state.project.settings.subtitlesEnabled);
  const filteredEpisodes = useMemo(() => { if (state.status !== "success") return []; const needle = query.trim().toLocaleLowerCase(); return state.project.episodes.filter((episode) => (statusFilter === "all" || episode.status === statusFilter) && (!needle || `${episode.episodeNumber} ${episode.title} ${episode.summary}`.toLocaleLowerCase().includes(needle))); }, [query, state, statusFilter]);
  async function updateTimeline(action: () => Promise<{ project: LongProject }>, select?: number): Promise<void> { if (timelinePending) return; setTimelinePending(true); setTimelineError(null); try { const result = await action(); setState({ status: "success", project: result.project }); setSelectedEpisodeNumber(select ?? null); setRemoveConfirmationOpen(false); setRemoveConfirmation(""); } catch (error: unknown) { setTimelineError(toLongProjectDisplayError(error)); } finally { setTimelinePending(false); } }
  function resumeEpisode(target: EpisodeResumeTarget, episodeNumber: number): void {
    if (target.screen === "script") onOpenEpisodeScript?.(projectId, episodeNumber);
    else if (target.screen === "mappingReview") onOpenMappingReview(projectId, episodeNumber);
    else if (target.screen === "imageGeneration") onOpenImageGeneration(projectId, episodeNumber);
    else if (target.screen === "videoWorkflow") onOpenVideoWorkflow(projectId, episodeNumber);
    else if (target.screen === "videoMerge") onOpenVideoMerge(projectId, episodeNumber);
    else if (target.screen === "episodeOutline") onOpenEpisodeOutline?.(projectId, episodeNumber);
    else onOpenContinuity(projectId, episodeNumber);
  }

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>목록으로</button>
      {state.status === "loading" && <Spinner label="불러오는 중..." className="mt-4" />}
      {state.status === "error" && <p className="mt-4 text-sm text-rose-400" role="alert" data-error-code={state.error.code}>{state.error.message}</p>}
      {state.status === "success" && (
        <>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButton} onClick={() => onOpenSettings(projectId)}>장기 프로젝트 설정</button>
            <button type="button" className={secondaryButton} onClick={() => onOpenOutline(projectId)}>스토리 개요 확인</button>
            <button type="button" className={secondaryButton} onClick={() => onOpenGallery(projectId)}>생성 이미지 모음</button>
            <button
              type="button"
              className="rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
              onClick={() => setArchiveOpen(true)}
            >
              프로젝트 보관하기
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
          {/*
           * Notices about the project rather than any one Episode — today, that the outline's paid call could
           * not be written to the spend ledger. It belongs here and nowhere else: one call produces every
           * Episode, so pinning it to one of them would be a lie and repeating it on all of them would be
           * noise (the reasoning in LongProjectSummary.warnings).
           *
           * Above the summary rather than below it, because it is about money that has already been spent —
           * the reader should meet it before the fields, not after scrolling past them.
           */}
          {state.project.warnings?.length ? (
            <ul data-testid="long-project-warnings" className="space-y-1 rounded-2xl border border-amber-400/30 bg-amber-500/5 p-4">
              {state.project.warnings.map((warning) => (
                <li key={warning} className="text-sm text-amber-300">{warning}</li>
              ))}
            </ul>
          ) : null}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-100 sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">ID</dt><dd className="mt-0.5">{state.project.id}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">제목</dt><dd className="mt-0.5">{state.project.title}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-slate-400">한 줄 줄거리</dt><dd className="mt-0.5">{state.project.logline}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">스토리 개요 상태</dt><dd className="mt-0.5" data-testid="outline-status">{longEpisodeStatusLabel(state.project.outlineStatus)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">장르</dt><dd className="mt-0.5">{state.project.settings.genre || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-slate-400">화면 비율</dt><dd className="mt-0.5">{state.project.settings.aspectRatio}</dd></div>
          </dl>
          {/* Episode 수 moved into this panel as "전체 에피소드" rather than being listed twice. */}
          <dl data-testid="episode-stage-summary" className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-100 sm:grid-cols-3">
            {episodeStageCounts(state.project.episodes).map((entry) => (
              <div key={entry.label} data-testid={`episode-stage-${entry.label}`}>
                <dt className="text-xs uppercase tracking-wide text-slate-400">{entry.label}</dt>
                <dd className={`mt-0.5 text-2xl font-semibold tabular-nums ${entry.highlight ? "text-amber-300" : "text-slate-100"}`}>
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
          <div data-testid="episode-list" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
            <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-200">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
              />
              에피소드 타임라인
            </h3>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="에피소드 검색"
                className={fieldClassName}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="에피소드 검색"
              />
              <select aria-label="에피소드 상태로 필터링" className={fieldClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">전체 상태</option>
                {[...new Set(state.project.episodes.map((episode) => episode.status))].sort().map((status) => <option key={status} value={status}>{longEpisodeStatusLabel(status)}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="에피소드 타임라인 작업">
              <button
                type="button"
                className={outlineButton}
                onClick={() => void updateTimeline(() => addLongEpisode(projectId), state.project.episodes.length + 1)}
                disabled={!editableTimeline || timelinePending}
              >
                에피소드 만들기
              </button>
              <button
                type="button"
                className={outlineButton}
                title="선택한 회차와 같은 내용으로 새 회차를 하나 더 만듭니다."
                onClick={() => selectedEpisode && void updateTimeline(() => duplicateLongEpisode(projectId, selectedEpisode.episodeNumber), state.project.episodes.length + 1)}
                disabled={!editableTimeline || !selectedEpisode || timelinePending}
              >
                선택한 에피소드 복제(하나 더 만들기)
              </button>
              <button
                type="button"
                className={outlineButton}
                onClick={() => { setRemoveConfirmationOpen(true); setRemoveConfirmation(""); }}
                disabled={!editableTimeline || !selectedEpisode || selectedEpisode.episodeNumber !== lastEpisodeNumber || timelinePending}
              >
                선택한 에피소드 보관하기
              </button>
            </div>
            {!editableTimeline && <p className="text-sm text-slate-400">타임라인 편집은 대본 작업이나 미디어 작업을 시작하기 전에만 가능합니다.</p>}
            {/*
              A disabled button with no stated reason reads as "broken", not as "not allowed" — someone clicks
              it, nothing happens, and they report that archiving does not work. Both conditions that disable it
              are now said out loud, in the order the person hits them.
            */}
            {editableTimeline && !selectedEpisode && (
              <p data-testid="episode-archive-hint" className="text-sm text-slate-400">
                보관하거나 복제하려면 아래 목록에서 에피소드를 먼저 선택해 주세요.
              </p>
            )}
            {editableTimeline && selectedEpisode && selectedEpisode.episodeNumber !== lastEpisodeNumber && (
              <p data-testid="episode-archive-hint" className="text-sm text-amber-300">
                보관은 마지막 회차({lastEpisodeNumber}화)만 할 수 있습니다. 중간 회차를 지우면 뒤 회차의 번호가 밀려서
                이미 만들어 둔 이미지·영상과 어긋나기 때문입니다. 지금 선택한 것은 {selectedEpisode.episodeNumber}화입니다.
              </p>
            )}
            {timelineError && <p className="text-sm text-rose-400" role="alert" data-error-code={timelineError.code}>{timelineError.message}</p>}
            {removeConfirmationOpen && selectedEpisode && (
              <section className="rounded-xl border border-rose-400/30 bg-rose-950/20 p-4" aria-label="에피소드 보관 확인">
                {/* Was: type "ARCHIVE EPISODE 3" — an English command string, demanded of a Korean creator, for
                    an action that is reversible (the episode goes to the archive and can be restored). The
                    typing gate belongs on the project-level archive above, which takes the whole project with
                    it; here it was ceremony that made a recoverable action feel destructive. The number is
                    still asked for, so the wrong episode cannot be archived by a mis-click. */}
                <p className="text-sm text-slate-300">
                  {selectedEpisode.episodeNumber}화를 보관함으로 옮깁니다. <strong className="text-slate-100">지워지는 게 아니라 아래 「보관한 회차」에서 다시 꺼낼 수 있습니다.</strong>{" "}
                  {/* Said here because it is the thing someone assumes wrongly, and the moment they assume it is
                      now — not when they come back to restore and find a different number. */}
                  다만 <strong className="text-slate-100">돌아올 때는 마지막 회차 번호</strong>가 됩니다.
                </p>
                <label className="mt-3 block text-sm text-slate-200" htmlFor="episode-archive-confirmation">
                  맞으면 회차 번호 <strong className="text-slate-100">{selectedEpisode.episodeNumber}</strong>을(를) 입력해 주세요
                </label>
                <input
                  id="episode-archive-confirmation"
                  inputMode="numeric"
                  className={`mt-1.5 w-full ${fieldClassName}`}
                  value={removeConfirmation}
                  onChange={(event) => setRemoveConfirmation(event.target.value)}
                  disabled={timelinePending}
                />
                <div className="mt-3 flex gap-2">
                  <button type="button" className={outlineButton} onClick={() => setRemoveConfirmationOpen(false)} disabled={timelinePending}>취소</button>
                  <button
                    type="button"
                    className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={() => void updateTimeline(() => archiveLongEpisode(projectId, selectedEpisode.episodeNumber))}
                    disabled={timelinePending || removeConfirmation.trim() !== String(selectedEpisode.episodeNumber)}
                  >
                    보관함으로 옮기기
                  </button>
                </div>
              </section>
            )}
            <ol className="space-y-1.5 text-sm text-slate-300">
              {filteredEpisodes.map((episode) => {
                const target = episodeResumeTarget(episode.status);
                const showResume = target && (target.screen !== "script" || onOpenEpisodeScript) && (target.screen !== "episodeOutline" || onOpenEpisodeOutline);
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
                    <span className={episode.status === "outline_ready" ? "text-emerald-400" : "text-slate-400"}>{longEpisodeStatusLabel(episode.status)}</span>
                    {/* Narration is a side channel, not a step in the fixed flow — it sits next to the resume
                        link rather than replacing it, and it is only offered when the project actually uses
                        these sentences for something (voice, subtitles, or both). With both off they are
                        stored but unused, and a link to them would be an invitation to nothing. */}
                    {narrationInUse && episodeHasScript(episode.status) && (
                      <button
                        type="button"
                        data-testid={`open-episode-narration-${episode.episodeNumber}`}
                        className="ml-auto text-slate-400 hover:text-slate-200"
                        onClick={() => onOpenNarrationReview(projectId, episode.episodeNumber)}
                      >
                        내레이션
                      </button>
                    )}
                    {/* The plan stays reachable while it is still editable, even once the resume link has moved
                        on to the script — "what happens in this episode" is the thing a person comes back to
                        change. Hidden once the backend would refuse the edit, rather than offered and then
                        refused. */}
                    {onOpenEpisodeOutline && episode.status === "outline_ready" && (
                      <button
                        type="button"
                        data-testid={`open-episode-outline-${episode.episodeNumber}`}
                        className="text-slate-400 hover:text-slate-200"
                        onClick={() => onOpenEpisodeOutline(projectId, episode.episodeNumber)}
                      >
                        이 회차 내용
                      </button>
                    )}
                    {showResume && (
                      <button type="button" className={`${narrationInUse && episodeHasScript(episode.status) ? "" : "ml-auto "}text-violet-300 hover:text-violet-200`} onClick={() => resumeEpisode(target, episode.episodeNumber)}>
                        {target.label}
                      </button>
                    )}
                    {/* An episode whose generation was interrupted is put back a step so it can be retried, but
                        without a sentence saying so the person just finds it sitting somewhere they did not
                        leave it — the same confusion short projects had before they carried this line
                        line. `w-full` puts it on its own row inside this wrapping flex
                        item so it reads as a note about the episode, not another control beside the buttons. */}
                    {episode.warnings?.map((warning) => (
                      <p
                        key={warning}
                        data-testid={`episode-warning-${episode.episodeNumber}`}
                        className="w-full text-xs text-amber-300"
                      >
                        {warning}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ol>
            {!filteredEpisodes.length && <p className="text-sm text-slate-400">이 조건에 맞는 에피소드가 없습니다.</p>}
          </div>

          {/* The shelf the archive confirmation has been promising. Until this existed that sentence pointed at
              nothing — the data and the routes were both there, and only the way back was missing. */}
          <details data-testid="episode-archives" className="rounded-2xl border border-white/10 bg-slate-900/70" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) loadArchives(); }}>
            <summary data-testid="episode-archives-summary" className="cursor-pointer px-5 py-4 text-base font-semibold text-slate-100">보관한 회차</summary>
            <div className="space-y-3 px-5 pb-5">

            {restoredAs && (
              <p role="status" data-testid="episode-restored" className="rounded-xl border border-emerald-400/30 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-300">
                「{restoredAs.title}」을(를) <strong className="text-emerald-200">{restoredAs.episodeNumber}화</strong>로 되돌렸습니다.
              </p>
            )}
            {archivesError && (
              <p role="alert" data-testid="episode-archives-error" data-error-code={archivesError.code} className="text-sm text-rose-400">
                {archivesError.message}
              </p>
            )}

            {archives === null && !archivesError && <p className="text-sm text-slate-400">보관함을 불러오는 중...</p>}

            {/* "표시할 것이 없다" and not "보관한 적이 없다": the server skips an archive it cannot read, so the
                screen has no standing to say the shelf is empty. */}
            {archives?.length === 0 && (
              <p data-testid="episode-archives-empty" className="text-sm text-slate-400">보관함에 표시할 회차가 없습니다.</p>
            )}

            {Boolean(archives?.length) && !editableTimeline && (
              /* Said before the button rather than after the server refuses. Restoring goes through the same
                 gate the timeline edits do, so once any Episode has moved past its draft the answer is already
                 no — and a person who learns that from a red error assumes they broke something. */
              <p role="status" data-testid="episode-restore-blocked" className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
                이미 대본이나 그림 작업에 들어간 회차가 있어서 지금은 되돌릴 수 없습니다. 보관한 회차는 그대로 있으니, 작업 중인 회차를 정리한 뒤에 다시 시도해 주세요.
              </p>
            )}

            {Boolean(archives?.length) && (
              <ul className="space-y-2">
                {archives!.map((archive) => (
                  <li key={archive.archiveId} data-testid={`episode-archive-${archive.archiveId}`} className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-100">{archive.title}</span>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {/* Parsed out of the folder name, so a folder named some other way has no date. Saying
                            so beats printing a time nobody recorded. */}
                        보관 당시 {archive.episodeNumber}화 · {archive.archivedAt ? dateLabel(archive.archivedAt) : "보관 시각 모름"}
                      </span>
                    </div>
                    {restoreConfirmId === archive.archiveId ? (
                      <div role="alertdialog" aria-label="회차 되돌리기 확인" data-testid={`episode-restore-confirm-${archive.archiveId}`} className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                        {/* The one thing this screen must not let someone assume. Archiving only ever takes the
                            last Episode and the project may have grown since, so putting it back where it left
                            from would either overwrite an Episode or renumber the ones after it. */}
                        <p className="text-sm text-slate-200">
                          <strong className="text-slate-100">{archive.episodeNumber}화가 아니라 마지막 회차로 돌아옵니다.</strong>{" "}
                          지금 {lastEpisodeNumber}화까지 있으니 {lastEpisodeNumber + 1}화가 됩니다. 내용은 보관할 때 그대로입니다.
                        </p>
                        <div className="flex gap-2">
                          <button type="button" className={outlineButton} disabled={restorePending} onClick={() => setRestoreConfirmId(null)}>취소</button>
                          <button type="button" data-testid={`episode-restore-confirm-button-${archive.archiveId}`} className={amberButton} disabled={restorePending} onClick={() => void restore(archive)}>
                            {restorePending ? "되돌리는 중..." : `네, ${lastEpisodeNumber + 1}화로 되돌립니다`}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`episode-restore-${archive.archiveId}`}
                        className={outlineButton}
                        disabled={!editableTimeline || restorePending}
                        onClick={() => setRestoreConfirmId(archive.archiveId)}
                      >
                        되돌리기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
