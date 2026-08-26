import { useEffect, useState } from "react";
import { sceneNumbersFor, type SceneNumber, type VideoLibraryProjectSummary, type VideoVersionSummary } from "@ai-animation-studio/shared";

import {
  getVideoLibrary,
  getVideoVersions,
  restoreVideoVersion,
  toVideoLibraryDisplayError,
  videoVersionContentUrl,
} from "../api/videoLibraryApi.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";

interface Props {
  onBack: () => void;
}

type DisplayError = { code: string; message: string };
type LibraryState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; projects: VideoLibraryProjectSummary[] };
type VersionsState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; versions: VideoVersionSummary[] };

/** A scene slot, or the merged result — the same address space the versions endpoint accepts. */
type Slot = SceneNumber | "final";

const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAmberButton =
  "rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function slotLabel(slot: Slot): string {
  return slot === "final" ? "최종 영상" : `${slot}번 장면`;
}

/** Sizes are shown so a person can tell a real clip from a truncated one at a glance, not to be precise. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ko-KR");
}

/**
 * The results archive: finished videos across every project, and — the part that has no other home — the past
 * versions each regeneration displaced. Those files already exist on disk, one paid regeneration each, with no
 * way to see or recover them until now. Distinct from the Asset Library, which holds input material fed *into*
 * generation; nothing here is ever sent to a provider (`.claude-bridge` Round 153).
 */
export function VideoLibraryScreen({ onBack }: Props) {
  const [state, setState] = useState<LibraryState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [openSlot, setOpenSlot] = useState<Slot | null>(null);
  const [versions, setVersions] = useState<VersionsState>({ status: "loading" });
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);
  const [restorePending, setRestorePending] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<DisplayError | null>(null);
  const [restoredVersionId, setRestoredVersionId] = useState<string | null>(null);

  function load(): void {
    setState({ status: "loading" });
    getVideoLibrary()
      .then((response) => setState({ status: "ready", projects: response.projects }))
      .catch((caught: unknown) => setState({ status: "error", error: toVideoLibraryDisplayError(caught) }));
  }

  useEffect(() => {
    load();
  }, []);

  function openSlotVersions(projectId: string, slot: Slot): void {
    setOpenProjectId(projectId);
    setOpenSlot(slot);
    setRestoreConfirm(null);
    setRestoreError(null);
    setRestoredVersionId(null);
    setVersions({ status: "loading" });
    getVideoVersions(projectId, slot)
      .then((response) => setVersions({ status: "ready", versions: response.versions }))
      .catch((caught: unknown) => setVersions({ status: "error", error: toVideoLibraryDisplayError(caught) }));
  }

  async function confirmRestore(projectId: string, slot: Slot, versionId: string): Promise<void> {
    if (restorePending) return;
    setRestorePending(versionId);
    setRestoreError(null);
    try {
      await restoreVideoVersion(projectId, slot, versionId);
      setRestoreConfirm(null);
      setRestoredVersionId(versionId);
      // The list itself changed (the previously current file was archived as a new version), so re-read rather
      // than patching isCurrent locally — a hand-patched list would hide the copy the server just made.
      const response = await getVideoVersions(projectId, slot);
      setVersions({ status: "ready", versions: response.versions });
      load();
    } catch (caught) {
      setRestoreError(toVideoLibraryDisplayError(caught));
    } finally {
      setRestorePending(null);
    }
  }

  const projects = state.status === "ready" ? state.projects : [];
  const term = query.trim().toLowerCase();
  const filtered = term
    ? projects.filter((project) => project.topic.toLowerCase().includes(term) || project.projectId.toLowerCase().includes(term))
    : projects;

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        영상 보관함
      </h1>
      <p className="text-sm text-slate-400">
        만들어진 영상과, 다시 만들 때마다 밀려난 예전 영상이 모두 남아 있습니다. 되돌리기는 무료이며 파일을 지우지 않습니다.
      </p>

      {state.status === "loading" && <Spinner label="보관함을 불러오는 중..." />}
      {state.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="library-error" data-error-code={state.error.code} className="text-sm text-rose-400">
            {state.error.message}
          </p>
          <button type="button" className={outlineButton} onClick={load}>
            다시 시도
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          <label className="block text-sm text-slate-300" htmlFor="library-search">
            프로젝트 찾기
            <input
              id="library-search"
              data-testid="library-search"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              placeholder="주제로 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {!projects.length && (
            <p data-testid="library-empty" className="text-sm text-slate-400">
              아직 만들어진 영상이 없습니다. 프로젝트에서 영상을 만들면 여기에 쌓입니다.
            </p>
          )}
          {Boolean(projects.length) && !filtered.length && (
            <p data-testid="library-no-match" className="text-sm text-slate-400">
              검색어에 맞는 프로젝트가 없습니다.
            </p>
          )}

          <ul className="space-y-3" data-testid="library-projects">
            {filtered.map((project) => {
              const open = openProjectId === project.projectId;
              return (
                <li key={project.projectId} data-testid={`library-project-${project.projectId}`} className={cardSection}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      className="text-left text-sm font-semibold text-slate-100"
                      aria-expanded={open}
                      onClick={() => (open ? setOpenProjectId(null) : openSlotVersions(project.projectId, 1 as SceneNumber))}
                    >
                      {project.topic || project.projectId}
                    </button>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={project.finalVideoAvailable ? "success" : "neutral"}>
                        {project.finalVideoAvailable ? "최종 영상 있음" : "최종 영상 없음"}
                      </StatusChip>
                      <span className="text-xs text-slate-400 tabular-nums" data-testid={`library-cost-${project.projectId}`}>
                        누적 ${project.totalActualCostUsd.toFixed(2)}
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 tabular-nums">
                    장면 {project.videosReadyCount}/{project.sceneCount} · {project.aspectRatio} · 마지막 변경 {dateTime(project.updatedAt)}
                  </p>
                  {/* The card, not just the merge screen, is where the credit line has to appear: the person
                      reading a merge result made it seconds ago, while the person reading this list is the one
                      coming back months later to finally publish it — the one who has forgotten
                      (`.claude-bridge` Round 177). */}
                  {project.attributionRequired && (
                    <p data-testid={`library-credit-${project.projectId}`} className="rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                      올릴 때 캡션에 출처를 적어야 합니다
                      {project.attributionText?.trim()
                        ? <span className="mt-1 block select-all text-slate-200">{project.attributionText.trim()}</span>
                        : <span className="mt-1 block text-slate-300">적을 문구가 비어 있습니다 — 음원 보관함에서 채워 주세요.</span>}
                    </p>
                  )}

                  {open && (
                    <div className="space-y-3" data-testid={`library-slots-${project.projectId}`}>
                      <div className="flex flex-wrap gap-2">
                        {sceneNumbersFor(project.sceneCount).map((sceneNumber) => (
                          <button
                            key={sceneNumber}
                            type="button"
                            data-testid={`library-slot-${project.projectId}-${sceneNumber}`}
                            className={openSlot === sceneNumber ? smallAmberButton : smallOutlineButton}
                            onClick={() => openSlotVersions(project.projectId, sceneNumber)}
                          >
                            {sceneNumber}번 장면
                          </button>
                        ))}
                        {/* Only offered when a merged result exists — a slot with nothing in it is a dead click. */}
                        {project.finalVideoAvailable && (
                          <button
                            type="button"
                            data-testid={`library-slot-${project.projectId}-final`}
                            className={openSlot === "final" ? smallAmberButton : smallOutlineButton}
                            onClick={() => openSlotVersions(project.projectId, "final")}
                          >
                            최종 영상
                          </button>
                        )}
                      </div>

                      {openSlot !== null && (
                        <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                          <p className="text-sm font-semibold text-slate-200">{slotLabel(openSlot)}</p>
                          {versions.status === "loading" && <Spinner label="버전을 불러오는 중..." />}
                          {versions.status === "error" && (
                            <p role="alert" data-testid="versions-error" data-error-code={versions.error.code} className="text-sm text-rose-400">
                              {versions.error.message}
                            </p>
                          )}
                          {versions.status === "ready" && !versions.versions.length && (
                            <p data-testid="versions-empty" className="text-sm text-slate-400">
                              이 자리에는 아직 저장된 영상이 없습니다.
                            </p>
                          )}
                          {versions.status === "ready" && versions.versions.map((version) => {
                            const confirming = restoreConfirm === version.versionId;
                            const pending = restorePending === version.versionId;
                            return (
                              <div
                                key={version.versionId}
                                data-testid={`version-${version.versionId}`}
                                data-current={version.isCurrent ? "true" : "false"}
                                className={`space-y-2 rounded-lg border p-3 ${version.isCurrent ? "border-emerald-400/30" : "border-white/10"}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-xs text-slate-300 tabular-nums">
                                    {dateTime(version.createdAt)} · {fileSize(version.bytes)}
                                  </span>
                                  <StatusChip tone={version.isCurrent ? "success" : "neutral"}>
                                    {version.isCurrent ? "현재 사용 중" : "이전 버전"}
                                  </StatusChip>
                                </div>
                                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- generated clips carry no caption track */}
                                <video
                                  data-testid={`version-player-${version.versionId}`}
                                  className={`${project.aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"} w-full rounded-lg border border-white/10 bg-slate-800`}
                                  controls
                                  preload="none"
                                  src={videoVersionContentUrl(project.projectId, openSlot, version.versionId)}
                                />
                                {/* Restoring is free, but it changes which bytes the project serves from now on —
                                    so it asks first, like every other action that changes stored work. The panel
                                    says plainly that nothing is deleted and that the merged result stops matching,
                                    because those are the two things a person would otherwise find out afterwards. */}
                                {!version.isCurrent && !confirming && (
                                  <button
                                    type="button"
                                    data-testid={`version-restore-${version.versionId}`}
                                    className={smallOutlineButton}
                                    disabled={Boolean(restorePending)}
                                    onClick={() => {
                                      setRestoreError(null);
                                      setRestoreConfirm(version.versionId);
                                    }}
                                  >
                                    이 버전으로 되돌리기
                                  </button>
                                )}
                                {confirming && (
                                  <div
                                    role="alertdialog"
                                    aria-label={`${slotLabel(openSlot)} 되돌리기 확인`}
                                    data-testid={`version-restore-confirm-${version.versionId}`}
                                    className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3"
                                  >
                                    <p className="text-sm font-semibold text-amber-300">이 버전으로 되돌릴까요?</p>
                                    <p className="text-xs text-slate-300">
                                      비용은 들지 않습니다. 지금 쓰고 있는 영상도 지워지지 않고 이전 버전으로 함께 보관됩니다.
                                      {openSlot !== "final" && " 이미 합쳐 둔 최종 영상은 이 장면과 맞지 않게 되므로 다시 합쳐야 합니다."}
                                    </p>
                                    {/* Versions are stored per file, but which audio a merge used is stored once
                                        per project — so after a restore the app genuinely cannot say which track
                                        this older file carried. Showing the last merge's credit line here would
                                        be worse than showing none: the user would paste it believing it.
                                        Said at the moment of the action, since that is the only moment they can
                                        still connect the loss to what they did (`.claude-bridge` Round 178). */}
                                    {project.attributionRequired && (
                                      <p data-testid={`version-restore-credit-warning-${version.versionId}`} className="text-xs text-amber-300">
                                        되돌리고 나면 이 영상에 출처 표시가 필요한지 앱이 더 이상 알 수 없습니다. 지금 문구를 적어 두세요:
                                        <span className="mt-1 block select-all text-slate-200">
                                          {project.attributionText?.trim() || "(문구가 비어 있습니다 — 음원 보관함에서 확인하세요)"}
                                        </span>
                                      </p>
                                    )}
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        className={smallOutlineButton}
                                        disabled={pending}
                                        onClick={() => setRestoreConfirm(null)}
                                      >
                                        취소
                                      </button>
                                      <button
                                        type="button"
                                        className={smallAmberButton}
                                        disabled={pending}
                                        onClick={() => void confirmRestore(project.projectId, openSlot, version.versionId)}
                                      >
                                        {pending ? "되돌리는 중..." : "예, 되돌립니다"}
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {restoredVersionId === version.versionId && (
                                  <p data-testid={`version-restored-${version.versionId}`} className="text-xs text-emerald-400">
                                    되돌렸습니다.
                                  </p>
                                )}
                              </div>
                            );
                          })}
                          {restoreError && (
                            <p role="alert" data-testid="restore-error" data-error-code={restoreError.code} className="text-sm text-rose-400">
                              {restoreError.message}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
