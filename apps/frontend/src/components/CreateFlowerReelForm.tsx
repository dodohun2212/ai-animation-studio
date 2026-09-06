import { useRef, useState, type FormEvent } from "react";
import {
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  STORY_ESTIMATED_COST_USD,
  type AspectRatio,
  type Project,
  type RunwayClipDurationSeconds,
  type ShortProjectSettingsInput,
} from "@ai-animation-studio/shared";

import { createProject, toDisplayError, updateProjectSettings } from "../api/projectsApi.js";
import { isSafeProjectId } from "../validation/projectId.js";

interface Props {
  onCreated: (project: Project) => void;
  onCancel: () => void;
}

const field =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

/** Scene counts this form offers. The contract allows up to MAX_SCENE_COUNT; these are the ones the growth arc divides into cleanly. */
const SCENE_COUNTS = [2, 3, 4] as const;
type SceneCount = (typeof SCENE_COUNTS)[number];

/**
 * 🔴 Every scene needs seventeen fields — visual_action, shot_size, camera_angle and the rest — and those are
 * what the image and video prompts actually read. Nobody types seventeen fields per scene, and an earlier
 * version of this screen tried to skip them: it wrote two fields by hand and the image prompt came out empty,
 * so the project could be created and then refused at the first paid step (CLI Round 609).
 *
 * Story generation is the one thing that fills all seventeen correctly. So this form does not write a script —
 * it writes the *brief* the script is generated from, and hands the project to the ordinary pipeline.
 */
function presetSettings(
  flower: string,
  meaning: string,
  originHint: string,
  sceneCount: SceneCount,
  clipDurationSeconds: RunwayClipDurationSeconds,
  aspectRatio: AspectRatio,
): ShortProjectSettingsInput {
  const name = flower.trim();
  const known = originHint.trim();
  return {
    projectName: `${name} 꽃말`,
    topic: `${name}의 꽃말 — ${meaning.trim()}`,
    genre: "정보·교양",
    mood: "차분하고 서정적, 잔잔한 경외감",
    // No cast: a flower reel has no character, and a name here would put one in the story prompt.
    character: "",
    lore: "",
    fullStory:
      `${name}의 꽃말인 "${meaning.trim()}"의 유래와 의미를 설명한다.\n`
      + `화면은 ${name} 씨앗이 흙에 심기는 데서 시작해, 싹이 트고 줄기가 자라 꽃이 활짝 피기까지 한 방향으로 진행한다.\n`
      + `장면이 넘어가도 같은 ${name}, 같은 화분, 같은 각도, 같은 빛을 유지한다.`
      + (known ? `\n\n유래에 대해 알고 있는 것: ${known}` : ""),
    sceneCount,
    clipDurationSeconds,
    additionalNotes:
      `내레이션은 꽃말과 그 유래를 설명하는 해설이다. 등장인물의 대사가 아니다.\n`
      // 🔴 The one prompt-level defence against an invented origin. It does not replace the script review —
      // that is where 캡틴D actually corrects a wrong fact, before any image is paid for — but a model told to
      // hedge writes "전해진다" instead of a confident date, and a hedge is far easier to spot and fix.
      + `확실하지 않은 유래는 단정하지 말고 "전해진다" 처럼 쓴다.`,
    styleNotes: {
      visualStyle: "사실적인 자연 접사 촬영, 얕은 심도",
      color: "따뜻한 아침 햇빛, 부드러운 초록과 흙빛",
      lighting: "부드러운 역광의 아침 햇살",
      camera: "거의 고정, 아주 느린 접근",
      dialogue: "",
      // 🔴 This one is not decoration. Each scene's video is generated from its own separately-drawn picture —
      // nothing carries the previous clip's last frame forward — so the flower can come out looking different
      // in each shot. `avoid` is one of the four style fields that actually reach the image prompt.
      avoid: "사람, 손, 글자, 로고, 화분이나 배경이 장면마다 바뀌는 것",
      aspect: aspectRatio,
    },
    narrationEnabled: true,
    subtitlesEnabled: true,
  };
}

/**
 * 꽃말 릴스 — a preset, not a second pipeline.
 *
 * It creates an ordinary short project and fills in the brief a flower reel needs: the seed-to-bloom arc, the
 * look, the scene count. Everything after that is the path every short project already takes, which is the
 * point — 599 claimed the pipeline was reused and it was only half true, because the scenes themselves were
 * not built the way the pipeline reads them.
 */
export function CreateFlowerReelForm({ onCreated, onCancel }: Props) {
  const [flowerName, setFlowerName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [originHint, setOriginHint] = useState("");
  const [projectId, setProjectId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [sceneCount, setSceneCount] = useState<SceneCount>(2);
  const [clipDurationSeconds, setClipDurationSeconds] = useState<RunwayClipDurationSeconds>(10);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  /**
   * The project exists but its preset did not save.
   *
   * 🔴 Two calls, and only the first is irreversible — a folder now exists on disk under that name. Sending
   * someone back to a form whose button would fail on a duplicate name, or navigating on silently and letting
   * them wonder why every field is empty, are both worse than saying it and offering the way forward.
   */
  const [created, setCreated] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Same guard as CreateProjectForm's: state updates are batched, so two fast clicks can both read false.
  const submittingRef = useRef(false);

  const suggestedId = flowerName.trim() ? `꽃말_${flowerName.trim().replace(/\s+/g, "_")}` : "";
  const effectiveId = (idTouched ? projectId : suggestedId).trim();
  const idUsable = effectiveId.length > 0 && isSafeProjectId(effectiveId);
  const ready = idUsable && flowerName.trim().length > 0 && meaning.trim().length > 0;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current || !ready) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    let project = created;
    try {
      // Skipped when a previous attempt already made the folder — creating it again would only ever return
      // PROJECT_ALREADY_EXISTS about the project this very screen just made.
      if (!project) {
        project = (await createProject({ projectId: effectiveId, topic: `${flowerName.trim()}의 꽃말 — ${meaning.trim()}` })).project;
        setCreated(project);
      }
      await updateProjectSettings(project.id, {
        settings: presetSettings(flowerName, meaning, originHint, sceneCount, clipDurationSeconds, aspectRatio),
      });
      onCreated(project);
    } catch (caught) {
      setError(toDisplayError(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 max-w-2xl space-y-5" onSubmit={(event) => void submit(event)} noValidate>
      <section aria-label="꽃과 꽃말" className={cardSection}>
        <label className="block text-sm text-slate-300" htmlFor="flower-name">
          꽃 이름
          <input
            id="flower-name"
            data-testid="flower-name"
            className={field}
            value={flowerName}
            disabled={submitting}
            placeholder="장미"
            onChange={(event) => setFlowerName(event.target.value)}
          />
        </label>

        <label className="block text-sm text-slate-300" htmlFor="flower-meaning">
          꽃말
          <input
            id="flower-meaning"
            data-testid="flower-meaning"
            className={field}
            value={meaning}
            disabled={submitting}
            placeholder="열정"
            onChange={(event) => setMeaning(event.target.value)}
          />
        </label>

        <label className="block text-sm text-slate-300" htmlFor="flower-origin">
          유래 — 알고 계신 것 (선택)
          <textarea
            id="flower-origin"
            data-testid="flower-origin"
            className={field}
            rows={3}
            value={originHint}
            disabled={submitting}
            placeholder="비워 두시면 AI가 알아서 씁니다. 적어 두시면 그 내용을 씁니다."
            onChange={(event) => setOriginHint(event.target.value)}
          />
        </label>
        {/* 🔴 The honest limit of this field, said before the money rather than after it. A model asked for a
            fact returns something shaped like one, and the free script-review step is where that gets caught. */}
        <p className="text-xs text-slate-500" data-testid="flower-origin-note">
          꽃말의 유래는 사실이라 AI가 그럴듯하게 지어낼 수 있습니다. 대본이 나오면 <span className="text-slate-300">이미지를 만들기 전에 고치실 수 있습니다</span> — 그 단계는 무료입니다.
        </p>

        <label className="block text-sm text-slate-300" htmlFor="flower-project-id">
          폴더 이름
          <input
            id="flower-project-id"
            data-testid="flower-project-id"
            className={field}
            value={idTouched ? projectId : suggestedId}
            disabled={submitting || created !== null}
            onChange={(event) => { setIdTouched(true); setProjectId(event.target.value); }}
          />
        </label>
        <p className="text-xs text-slate-500">한글·영문·숫자와 _ - 를 쓸 수 있고 띄어쓰기는 쓸 수 없습니다. 만든 뒤에는 바꿀 수 없습니다.</p>
        {effectiveId.length > 0 && !isSafeProjectId(effectiveId) && (
          <p data-testid="flower-id-invalid" className="text-xs text-rose-400">
            띄어쓰기와 문장부호는 폴더 이름에 쓸 수 없습니다. 예: 꽃말_장미
          </p>
        )}
      </section>

      <section aria-label="길이와 화면" className={cardSection}>
        <div className="flex flex-wrap gap-4">
          <label className="block text-sm text-slate-300">
            장면 수
            <select
              data-testid="flower-scene-count"
              className={field}
              value={sceneCount}
              disabled={submitting}
              onChange={(event) => setSceneCount(Number(event.target.value) as SceneCount)}
            >
              {SCENE_COUNTS.filter((value) => value >= MIN_SCENE_COUNT).map((value) => <option key={value} value={value}>{value}개</option>)}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            장면당 길이
            <select
              data-testid="flower-clip-duration"
              className={field}
              value={clipDurationSeconds}
              disabled={submitting}
              onChange={(event) => setClipDurationSeconds(Number(event.target.value) as RunwayClipDurationSeconds)}
            >
              {RUNWAY_CLIP_DURATIONS.map((value) => <option key={value} value={value}>{value}초</option>)}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            화면 비율
            <select
              data-testid="flower-aspect"
              className={field}
              value={aspectRatio}
              disabled={submitting}
              onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}
            >
              <option value="9:16">세로 (9:16)</option>
              <option value="16:9">가로 (16:9)</option>
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-400" data-testid="flower-length-note">
          전체 <span className="font-semibold text-slate-200 tabular-nums">{sceneCount * clipDurationSeconds}초</span>.
        </p>
        <p className="text-sm text-slate-400" data-testid="flower-seam-note">
          장면마다 영상을 따로 만들기 때문에 <span className="font-semibold text-slate-200">이음매마다 꽃 모양이 조금 달라질 수 있습니다.</span>
          {" "}장면을 적게, 길게 잡을수록 그 자리가 줄어듭니다.
        </p>
      </section>

      {/* 🔴 This sentence used to say the opposite — "여기까지는 비용이 들지 않습니다" — and it was true only
          while this form wrote the script itself. The script now comes from a paid call, so the old line would
          be a screen promising something it no longer does, on the button that spends the money. */}
      <p className="text-sm text-slate-400" data-testid="flower-cost-note">
        <span className="font-semibold text-slate-200">만들면 곧바로 대본 생성(${STORY_ESTIMATED_COST_USD.toFixed(2)})이 이어집니다.</span>{" "}
        이미지와 영상은 그 뒤에 따로 확인하고 만듭니다. 각 단계마다 금액이 나옵니다.
      </p>

      {created !== null && error !== null && (
        <p role="alert" data-testid="flower-partial" className="text-sm text-amber-300">
          프로젝트 「{created.id}」는 만들어졌습니다. 서식 값을 저장하는 데만 실패했으니, 다시 시도하시거나 설정 화면에서 직접 채우셔도 됩니다.
        </p>
      )}
      {error && (
        <p role="alert" data-testid="flower-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          data-testid="flower-submit"
          disabled={!ready || submitting}
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
        >
          {submitting ? "만드는 중..." : created !== null ? "서식 값 다시 저장" : "꽃말 릴스 만들기"}
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-slate-300 hover:bg-white/5"
          disabled={submitting}
          onClick={onCancel}
        >
          취소
        </button>
      </div>
    </form>
  );
}
