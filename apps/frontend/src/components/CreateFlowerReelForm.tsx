import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  FLOWER_CARD_CAPTION_MAX_LENGTH,
  FLOWER_CARD_DESCRIPTION_MAX_LENGTH,
  FLOWER_CARD_MEANING_MAX_LENGTH,
  FLOWER_CARD_NAME_MAX_LENGTH,
  RUNWAY_CLIP_DURATIONS,
  type AspectRatio,
  type Project,
  type RunwayClipDurationSeconds,
} from "@ai-animation-studio/shared";

import { createFlowerCard, toFlowerCardDisplayError } from "../api/flowerCardsApi.js";
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
 * The seed-to-bloom beats, pre-written so the person fills in words rather than inventing shot descriptions.
 *
 * 🔴 Every beat repeats "같은 화분, 같은 각도, 같은 빛" on purpose. Each scene's video is generated from its
 * own separately-drawn picture — nothing carries the previous clip's last frame forward — so the flower can
 * come out looking like a different flower in each shot. Saying the frame is unchanged in every prompt is the
 * only lever this screen has against that, and a person editing these lines should know not to delete it.
 */
function beats(count: SceneCount, flower: string): string[] {
  const name = flower.trim() || "꽃";
  const same = "같은 화분, 같은 각도, 같은 빛.";
  if (count === 2) {
    return [
      `${name} 씨앗이 흙 위에 놓이고 흙이 덮인 뒤, 첫 싹이 흙을 밀고 올라온다. 아침 햇빛. ${same}`,
      `${name}의 줄기가 자라 봉오리가 맺히고, 꽃잎이 하나씩 열려 활짝 핀다. ${same}`,
    ];
  }
  if (count === 3) {
    return [
      `${name} 씨앗이 흙 위에 놓이고 흙이 덮인다. 아침 햇빛. ${same}`,
      `흙을 밀고 ${name}의 싹이 올라와 줄기가 자라고 봉오리가 맺힌다. ${same}`,
      `${name}의 꽃잎이 하나씩 열려 활짝 핀다. ${same}`,
    ];
  }
  return [
    `${name} 씨앗이 흙 위에 놓이고 흙이 덮인다. 아침 햇빛. ${same}`,
    `흙을 밀고 ${name}의 첫 싹이 올라온다. ${same}`,
    `${name}의 줄기가 자라 봉오리가 맺힌다. ${same}`,
    `${name}의 꽃잎이 하나씩 열려 활짝 핀다. ${same}`,
  ];
}

/**
 * 꽃말 릴스 — a flower's meaning told over a seed being planted and opening into the bloom.
 *
 * 🔴 The script is typed here rather than generated, and that is the whole reason this form exists. A flower's
 * origin is a fact, and a story model asked for a fact returns something shaped like one; 캡틴D chose to write
 * these by hand for that reason. So this is the one create path that calls no paid model — the first charge is
 * image generation, which has its own confirmation screen.
 */
export function CreateFlowerReelForm({ onCreated, onCancel }: Props) {
  const [flowerName, setFlowerName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [projectId, setProjectId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [sceneCount, setSceneCount] = useState<SceneCount>(2);
  const [clipDurationSeconds, setClipDurationSeconds] = useState<RunwayClipDurationSeconds>(10);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const [captions, setCaptions] = useState<Record<number, string>>({});
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Same guard as CreateProjectForm's: state updates are batched, so two fast clicks can both read false.
  const submittingRef = useRef(false);

  const templates = useMemo(() => beats(sceneCount, flowerName), [sceneCount, flowerName]);
  /** An untouched description follows the template, so changing the flower or the scene count updates it; an edited one is never overwritten. */
  const descriptionFor = (index: number): string => descriptions[index] ?? templates[index] ?? "";
  const suggestedId = flowerName.trim() ? `꽃말_${flowerName.trim().replace(/\s+/g, "_")}` : "";
  const effectiveId = (idTouched ? projectId : suggestedId).trim();

  const scenes = Array.from({ length: sceneCount }, (_, index) => ({
    description: descriptionFor(index).trim(),
    caption: (captions[index] ?? "").trim(),
  }));
  const idUsable = effectiveId.length > 0 && isSafeProjectId(effectiveId);
  const withinLimits =
    flowerName.trim().length > 0 && flowerName.trim().length <= FLOWER_CARD_NAME_MAX_LENGTH
    && meaning.trim().length > 0 && meaning.trim().length <= FLOWER_CARD_MEANING_MAX_LENGTH
    && scenes.every((scene) =>
      scene.description.length > 0 && scene.description.length <= FLOWER_CARD_DESCRIPTION_MAX_LENGTH
      && scene.caption.length > 0 && scene.caption.length <= FLOWER_CARD_CAPTION_MAX_LENGTH);
  const ready = idUsable && withinLimits;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current || !ready) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const response = await createFlowerCard({
        projectId: effectiveId,
        flowerName: flowerName.trim(),
        meaning: meaning.trim(),
        scenes,
        clipDurationSeconds,
        aspectRatio,
      });
      onCreated(response.project);
    } catch (caught) {
      setError(toFlowerCardDisplayError(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const counter = (used: number, max: number) => (
    <span className={`text-xs tabular-nums ${used > max ? "text-rose-400" : "text-slate-500"}`}>{used} / {max}자</span>
  );

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
        {counter(flowerName.trim().length, FLOWER_CARD_NAME_MAX_LENGTH)}
        <p className="text-xs text-slate-500">모든 장면이 이 꽃을 그립니다. 아래 화면 묘사에도 자동으로 들어갑니다.</p>

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
        {counter(meaning.trim().length, FLOWER_CARD_MEANING_MAX_LENGTH)}

        <label className="block text-sm text-slate-300" htmlFor="flower-project-id">
          폴더 이름
          <input
            id="flower-project-id"
            data-testid="flower-project-id"
            className={field}
            value={idTouched ? projectId : suggestedId}
            disabled={submitting}
            onChange={(event) => { setIdTouched(true); setProjectId(event.target.value); }}
          />
        </label>
        {/* The real rule, not a narrower one. `\p{L}` accepts Hangul — every 명언 card on this machine is named
            in Korean — so a form telling someone otherwise is refusing a name the server would have taken. */}
        <p className="text-xs text-slate-500">한글·영문·숫자와 _ - 를 쓸 수 있습니다. 띄어쓰기는 쓸 수 없습니다. 만든 뒤에는 바꿀 수 없습니다.</p>
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
              {SCENE_COUNTS.map((value) => <option key={value} value={value}>{value}개</option>)}
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
          {/* 🔴 Deliberately no dollar figure here. The rate depends on the video model chosen in API 설정, and
              quoting money low is the one direction this must never be wrong in — the generation screen quotes
              it from the model actually selected. */}
          {" "}장면이 많고 길수록 이미지·영상 생성 단계에서 드는 비용이 늘어납니다. 정확한 금액은 그 화면에서 확인하실 수 있습니다.
        </p>
        <p className="text-sm text-slate-400" data-testid="flower-seam-note">
          장면마다 영상을 따로 만들기 때문에 <span className="font-semibold text-slate-200">이음매마다 꽃 모양이 조금 달라질 수 있습니다.</span>
          {" "}장면을 적게, 길게 잡을수록 그 자리가 줄어듭니다.
        </p>
      </section>

      {Array.from({ length: sceneCount }, (_, index) => (
        <section key={index} aria-label={`${index + 1}번 장면`} className={cardSection}>
          <h3 className="text-base font-semibold text-slate-100">{index + 1}번 장면</h3>
          <label className="block text-sm text-slate-300">
            화면 묘사
            <textarea
              data-testid={`flower-description-${index}`}
              className={field}
              rows={3}
              value={descriptionFor(index)}
              disabled={submitting}
              onChange={(event) => setDescriptions((old) => ({ ...old, [index]: event.target.value }))}
            />
          </label>
          {counter(descriptionFor(index).trim().length, FLOWER_CARD_DESCRIPTION_MAX_LENGTH)}
          <label className="block text-sm text-slate-300">
            자막 문장
            <textarea
              data-testid={`flower-caption-${index}`}
              className={field}
              rows={2}
              value={captions[index] ?? ""}
              disabled={submitting}
              placeholder="이 장면에 깔릴 문장을 적어 주세요"
              onChange={(event) => setCaptions((old) => ({ ...old, [index]: event.target.value }))}
            />
          </label>
          {counter((captions[index] ?? "").trim().length, FLOWER_CARD_CAPTION_MAX_LENGTH)}
        </section>
      ))}

      <p className="text-sm text-slate-400" data-testid="flower-free-note">
        <span className="font-semibold text-slate-200">여기까지는 비용이 들지 않습니다</span> — 대본을 직접 쓰시기 때문에 AI를 부르지 않습니다.
        만든 다음 이미지와 영상을 만들 때부터 비용이 듭니다.
      </p>

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
          {submitting ? "만드는 중..." : "꽃말 릴스 만들기"}
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
