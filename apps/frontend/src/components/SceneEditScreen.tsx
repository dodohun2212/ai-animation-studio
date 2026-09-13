import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Scene, SceneNumber, SceneStaleness } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { getProject, toDisplayError } from "../api/projectsApi.js";
import { toSceneEditDisplayError, updateScene } from "../api/sceneEditApi.js";
import { Spinner } from "./Spinner.js";
import { StaleBadge } from "./ui/StaleBadge.js";
import { SCENE_FIELD_GROUPS, SCENE_FIELD_KEYS } from "../utils/sceneFields.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { cardSection, outlineButton, primaryButton } from "./ui/surfaces.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; project: Project };

const fieldClassName =
  "mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50";

/**
 * Where a scene's stale image can actually be re-made — `image-review.service.ts` and `episode-images.service.ts`
 * both reject a regeneration outside these two states (verified in the backend source, not assumed from this
 * screen's own comment, which used to name a review screen unconditionally — Cowork Round 863/867).
 */
const IMAGE_FIX_STATES = new Set<WorkflowState>([WorkflowState.ImagesReview, WorkflowState.WaitingForVideoConfirmation]);

/**
 * Where a stale video can be regenerated — `local-video-workflow.service.ts:630-633`'s `regenerate()` accepts
 * ReviewingVideos / VideosReady / VideosApproved outright (CLI Round 869, measuring exactly this). It also
 * accepts GeneratingVideos, but only for scenes the job has already marked failed — a scene stale from a scene
 * edit is not that, so GeneratingVideos is deliberately left out here rather than over-claimed. Interrupted is
 * not in the backend's allow-list either. Past this set (Rendering, Completed, Failed, Cancelled) the backend
 * rejects it (VIDEO_WORKFLOW_NOT_ALLOWED) regardless of what this screen says.
 */
const VIDEO_FIX_STATES = new Set<WorkflowState>([
  WorkflowState.VideosReady,
  WorkflowState.ReviewingVideos,
  WorkflowState.VideosApproved,
]);

/** No workflow_state check exists anywhere in narration/*.ts — confirmed by CLI reading `narration-review.
 *  service.ts:114-126` (Round 869): it looks only at `narrationEnabled` and whether the scene has narration
 *  text, never at workflow_state. A stale narration is reachable from its review screen no matter what state
 *  the rest of the project is in. */
function canFixFromReviewScreen(kind: "image" | "video" | "narration", workflowState: WorkflowState): boolean {
  if (kind === "image") return IMAGE_FIX_STATES.has(workflowState);
  if (kind === "video") return VIDEO_FIX_STATES.has(workflowState);
  return true;
}

function valueOf(scene: Scene | undefined, key: string): string {
  if (!scene) return "";
  const value = (scene as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function SceneEditScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<SceneNumber | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<DisplayError | null>(null);
  const [staleness, setStaleness] = useState<SceneStaleness | null>(null);
  const [savedSceneNumber, setSavedSceneNumber] = useState<SceneNumber | null>(null);
  const loadRequest = useRef(0);
  const saveBusy = useRef(false);

  useEffect(() => {
    const requestId = ++loadRequest.current;
    setState({ status: "loading" });
    getProject(projectId)
      .then((response) => {
        if (requestId !== loadRequest.current) return;
        setState({ status: "ready", project: response.project });
        setSelected((current) => current ?? (response.project.scenes[0]?.number ?? null));
      })
      .catch((caught: unknown) => {
        if (requestId !== loadRequest.current) return;
        setState({ status: "error", error: toDisplayError(caught) });
      });
  }, [projectId]);

  const scenes = state.status === "ready" ? state.project.scenes : [];
  const scene = useMemo(() => scenes.find((item) => item.number === selected), [scenes, selected]);

  /**
   * Opening a different scene drops whatever was typed into the previous one, so edits never leak between
   * scenes. That reset lives in the tab's click handler (`openScene`) and deliberately NOT in an effect on
   * `[selected]`, which is where it used to live.
   *
   * An effect on `[selected]` runs for every reason `selected` changes, and a click is not the only one: it
   * also goes from null to the first scene when the initial GET resolves. React runs passive effects after
   * commit, so between the inputs appearing on screen and that effect running there is a real window in which
   * a fast typist has already typed — and the effect then wiped it, with the save button falling back to
   * disabled and no error shown. Reproducing that window in a test is a scheduling race, which is why it
   * surfaced as an intermittently red test rather than a failing one; guarding the effect with a "was this the
   * first selection" ref would have closed the same window but left the shape that produced it. Resetting from
   * the event that actually means "the person moved to another scene" removes the window instead of narrowing
   * it: nothing clears the draft now except this click, an explicit 되돌리기, or a successful save.
   */
  function openScene(number: SceneNumber): void {
    setSelected(number);
    setDraft({});
    setSaveError(null);
    setSavedSceneNumber(null);
  }

  const currentValue = (key: string) => (key in draft ? draft[key]! : valueOf(scene, key));
  const changedKeys = SCENE_FIELD_KEYS.filter((key) => key in draft && draft[key] !== valueOf(scene, key));
  const hasChanges = changedKeys.length > 0;

  async function save(): Promise<void> {
    if (!scene || saveBusy.current || !hasChanges) return;
    saveBusy.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const edits = Object.fromEntries(changedKeys.map((key) => [key, draft[key]!]));
      const response = await updateScene(projectId, scene.number, edits);
      setState({ status: "ready", project: response.project });
      setStaleness(response.staleness);
      setSavedSceneNumber(scene.number);
      setDraft({});
    } catch (caught) {
      setSaveError(toSceneEditDisplayError(caught));
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <ScreenHeader
        title="장면 편집"
        backLabel="프로젝트로 돌아가기"
        onBack={onBack}
        description={'장면 하나만 고칠 수 있습니다. 대본 전체를 다시 만들지 않아도 되고, 이미 확정한 이미지와 영상도 지워지지 않습니다. 다만 고친 내용에 따라 다시 만들어야 하는 것이 생기는데, 항목마다 무엇이 그런지 아래에 적어뒀습니다.'}
      />

      {state.status === "loading" && <Spinner label="장면을 불러오는 중..." />}
      {state.status === "error" && (
        <p role="alert" data-testid="scene-edit-load-error" data-error-code={state.error.code} className="text-sm text-rose-400">
          {state.error.message}
        </p>
      )}

      {state.status === "ready" && scenes.length === 0 && (
        <p data-testid="scene-edit-empty" className="text-sm text-slate-400">
          아직 장면이 없습니다. 대본을 먼저 만들어 주세요.
        </p>
      )}

      {state.status === "ready" && scenes.length > 0 && (
        <>
          <nav aria-label="장면 선택" className="flex flex-wrap gap-2">
            {scenes.map((item) => (
              <button
                key={item.number}
                type="button"
                data-testid={`scene-edit-tab-${item.number}`}
                data-selected={item.number === selected ? "true" : "false"}
                className={`rounded-full border px-3.5 py-1.5 text-sm ${
                  item.number === selected
                    ? "border-violet-400/50 bg-violet-500/15 text-violet-200"
                    : "border-white/10 text-slate-300 hover:bg-white/5"
                }`}
                onClick={() => openScene(item.number)}
              >
                {item.number}번 장면
              </button>
            ))}
          </nav>

          {savedSceneNumber !== null && staleness && (
            <section
              aria-label="저장 결과"
              data-testid="scene-edit-saved"
              className="space-y-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.07] p-4"
            >
              <p className="text-sm font-semibold text-emerald-300">{savedSceneNumber}번 장면을 저장했습니다.</p>
              {staleness.imageStale.length === 0 &&
              staleness.videoStale.length === 0 &&
              staleness.narrationStale.length === 0 ? (
                <p className="text-sm text-slate-300">다시 만들어야 할 것은 없습니다.</p>
              ) : (
                <ul className="space-y-1 text-sm text-slate-300">
                  {staleness.imageStale.length > 0 && (
                    <li data-testid="scene-edit-stale-image">
                      · 이미지를 다시 만들어야 하는 장면: {staleness.imageStale.join(", ")}번
                      {!canFixFromReviewScreen("image", state.project.workflowState) && (
                        <span data-testid="scene-edit-stale-image-unreachable" className="block text-amber-300">
                          지금 프로젝트 상태에서는 이미지 검토 화면에서 다시 만들 수 없습니다.
                        </span>
                      )}
                    </li>
                  )}
                  {staleness.videoStale.length > 0 && (
                    <li data-testid="scene-edit-stale-video">
                      · 영상을 다시 만들어야 하는 장면: {staleness.videoStale.join(", ")}번
                      {!canFixFromReviewScreen("video", state.project.workflowState) && (
                        <span data-testid="scene-edit-stale-video-unreachable" className="block text-amber-300">
                          지금 프로젝트 상태에서는 영상 검토 화면에서 다시 만들 수 없습니다.
                        </span>
                      )}
                    </li>
                  )}
                  {staleness.narrationStale.length > 0 && (
                    <li data-testid="scene-edit-stale-narration">
                      · 음성을 다시 만들어야 하는 장면: {staleness.narrationStale.join(", ")}번
                    </li>
                  )}
                </ul>
              )}
              {/*
               * 🔴 이전 문구는 모든 상태에서 "각 검토 화면에서 다시 만들면 됩니다"라고 단정했지만, 이미지
               * 재생성은 IMAGES_REVIEW·WAITING_FOR_VIDEO_CONFIRMATION 두 상태에서만, 영상 재생성은 그보다
               * 넓은 몇몇 상태에서만 백엔드가 허용한다(각각 image-review.service.ts, episode-images.service.ts,
               * local-video-workflow.service.ts에서 확인). 지금 상태를 벗어나면 위에 상태별 경고가 대신
               * 뜨므로, 여기서는 되돌릴 수 없는 것만 남는다고 단정하지 않는다.
               */}
              <p className="text-xs text-slate-400">
                지금 다시 만들 수 있는 항목은 각 검토 화면에서 해당 장면만 다시 만들면 됩니다. 이미 만들어 둔 것은 그대로 남아 있습니다.
              </p>
            </section>
          )}

          {SCENE_FIELD_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title} data-testid={`scene-edit-group-${group.title}`} className={cardSection}>
              <header className="space-y-1">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
                  <span aria-hidden="true" className="h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
                  {group.title}
                  {selected !== null && group.title === "구도" && (
                  <>
                  <StaleBadge staleSceneNumbers={staleness?.imageStale} sceneNumber={selected} kind="image" />
                  {/* At most one of the two ever renders: the server puts a scene in one list or the other. */}
                  <StaleBadge staleSceneNumbers={staleness?.styleStale} sceneNumber={selected} kind="style" />
                  </>
                  )}
                  {selected !== null && group.title === "내레이션 문장" && (
                  <StaleBadge staleSceneNumbers={staleness?.narrationStale} sceneNumber={selected} kind="narration" />
                  )}
                </h2>
                <p className={`text-xs ${group.free ? "text-slate-400" : "text-amber-300"}`}>{group.impact}</p>
              </header>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <label
                    key={field.key}
                    className={`block text-sm text-slate-300 ${field.multiline ? "sm:col-span-2" : ""}`}
                    htmlFor={`scene-field-${field.key}`}
                  >
                    {field.label}
                    {field.multiline ? (
                      <textarea
                        id={`scene-field-${field.key}`}
                        rows={3}
                        className={fieldClassName}
                        value={currentValue(field.key)}
                        disabled={saving}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                      />
                    ) : (
                      <input
                        id={`scene-field-${field.key}`}
                        className={fieldClassName}
                        value={currentValue(field.key)}
                        disabled={saving}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>
          ))}

          {saveError && (
            <p role="alert" data-testid="scene-edit-save-error" data-error-code={saveError.code} className="text-sm text-rose-400">
              {saveError.message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="scene-edit-save"
              className={primaryButton}
              onClick={() => void save()}
              disabled={!hasChanges || saving}
            >
              {saving ? "저장하는 중..." : "이 장면 저장"}
            </button>
            <button
              type="button"
              data-testid="scene-edit-reset"
              className={outlineButton}
              onClick={() => setDraft({})}
              disabled={!hasChanges || saving}
            >
              고친 내용 되돌리기
            </button>
            <span data-testid="scene-edit-change-count" className="text-xs text-slate-400">
              {hasChanges ? `${changedKeys.length}개 항목이 바뀌었습니다` : "바뀐 항목이 없습니다"}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
