import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Scene, SceneNumber, SceneStaleness } from "@ai-animation-studio/shared";

import { getProject, toDisplayError } from "../api/projectsApi.js";
import { toSceneEditDisplayError, updateScene } from "../api/sceneEditApi.js";
import { Spinner } from "./Spinner.js";
import { StaleBadge } from "./ui/StaleBadge.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; project: Project };

/** Every field the edit endpoint accepts, in the order they are shown. */
type EditableField = {
  key: string;
  label: string;
  multiline?: boolean;
};

/**
 * The editable fields grouped by what editing them actually costs.
 *
 * The grouping is the point of this screen: the endpoint accepts one flat set of fields, but they are not
 * equivalent — changing a composition field means paying to regenerate an image (and the video built from it),
 * while changing the narrated script costs nothing at all. Showing them in one undifferentiated list would hide
 * that, and the user would only discover the consequence after saving. `impact` is therefore stated up front,
 * not after the fact.
 */
const FIELD_GROUPS: { title: string; impact: string; free?: boolean; fields: EditableField[] }[] = [
  {
    title: "화면 대본",
    impact: "고쳐도 다시 만들 것이 없습니다.",
    free: true,
    fields: [{ key: "description", label: "장면 대본", multiline: true }],
  },
  {
    title: "내레이션 문장",
    impact: "고치면 이 장면의 음성을 다시 만들어야 합니다.",
    fields: [{ key: "narration", label: "읽어줄 문장", multiline: true }],
  },
  {
    title: "구도",
    impact: "고치면 이 장면의 이미지를 다시 만들어야 하고, 그 이미지로 만든 영상도 다시 만들어야 합니다.",
    fields: [
      { key: "visual_action", label: "화면에 보이는 행동", multiline: true },
      { key: "shot_size", label: "샷 크기" },
      { key: "camera_angle", label: "카메라 앵글" },
      { key: "composition", label: "구도" },
      { key: "lens_feel", label: "렌즈 느낌" },
      { key: "focus_subject", label: "초점 대상" },
    ],
  },
  {
    title: "움직임",
    impact: "고치면 이 장면의 영상을 다시 만들어야 합니다. 이미지는 그대로 쓸 수 있습니다.",
    fields: [
      { key: "start_motion", label: "시작 동작" },
      { key: "main_motion", label: "주요 동작" },
      { key: "expression_change", label: "표정 변화" },
      { key: "camera_motion", label: "카메라 움직임" },
      { key: "environment_motion", label: "배경 움직임" },
      { key: "motion_speed", label: "움직임 속도" },
      { key: "motion_intensity", label: "움직임 강도" },
    ],
  },
  {
    title: "다음 장면과의 연결",
    impact: "고치면 이 장면과 다음 장면의 영상을 모두 다시 만들어야 합니다.",
    fields: [
      { key: "end_motion", label: "마무리 동작" },
      { key: "continuity_hint", label: "이어짐 힌트" },
    ],
  },
];

const ALL_FIELD_KEYS = FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key));

const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const fieldClassName =
  "mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

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

  // Reset the draft whenever a different scene is opened, so edits never leak between scenes.
  useEffect(() => {
    setDraft({});
    setSaveError(null);
    setSavedSceneNumber(null);
  }, [selected]);

  const currentValue = (key: string) => (key in draft ? draft[key]! : valueOf(scene, key));
  const changedKeys = ALL_FIELD_KEYS.filter((key) => key in draft && draft[key] !== valueOf(scene, key));
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
      <header className="space-y-1.5">
        <button type="button" className="text-xs text-slate-400 hover:text-slate-300" onClick={onBack}>
          <span aria-hidden="true">←</span> 프로젝트로 돌아가기
        </button>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          장면 편집
        </h1>
      </header>
      <p className="text-sm leading-relaxed text-slate-400">
        장면 하나만 고칠 수 있습니다. 대본 전체를 다시 만들지 않아도 되고, 이미 확정한 이미지와 영상도 지워지지
        않습니다. 다만 고친 내용에 따라 다시 만들어야 하는 것이 생기는데, 항목마다 무엇이 그런지 아래에 적어뒀습니다.
      </p>

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
                onClick={() => setSelected(item.number)}
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
                    </li>
                  )}
                  {staleness.videoStale.length > 0 && (
                    <li data-testid="scene-edit-stale-video">
                      · 영상을 다시 만들어야 하는 장면: {staleness.videoStale.join(", ")}번
                    </li>
                  )}
                  {staleness.narrationStale.length > 0 && (
                    <li data-testid="scene-edit-stale-narration">
                      · 음성을 다시 만들어야 하는 장면: {staleness.narrationStale.join(", ")}번
                    </li>
                  )}
                </ul>
              )}
              <p className="text-xs text-slate-400">
                각 검토 화면에서 해당 장면만 다시 만들면 됩니다. 이미 만들어 둔 것은 그대로 남아 있습니다.
              </p>
            </section>
          )}

          {FIELD_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title} data-testid={`scene-edit-group-${group.title}`} className={cardSection}>
              <header className="space-y-1">
                <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-100">
                  {group.title}
                  {selected !== null && group.title === "구도" && (
                    <StaleBadge staleSceneNumbers={staleness?.imageStale} sceneNumber={selected} kind="image" />
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
