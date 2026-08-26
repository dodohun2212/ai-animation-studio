import { useState } from "react";
import {
  IMAGE_ESTIMATED_COST_USD,
  LONG_OUTLINE_ESTIMATED_COST_USD,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  STORY_ESTIMATED_COST_USD,
  TTS_ESTIMATED_COST_USD,
  VIDEO_SCENE_ESTIMATED_COST_USD,
  type RunwayClipDurationSeconds,
} from "@ai-animation-studio/shared";

interface Props {
  onBack: () => void;
}

type StageTone = "story" | "image" | "video" | "narration";

const STAGE_STYLES: Record<StageTone, { border: string; chip: string; accent: string }> = {
  story: {
    border: "border-violet-400/30",
    chip: "border-violet-400/50 bg-violet-500/15 text-violet-200",
    accent: "text-violet-200",
  },
  image: {
    border: "border-sky-400/30",
    chip: "border-sky-400/45 bg-sky-500/15 text-sky-200",
    accent: "text-sky-200",
  },
  video: {
    border: "border-rose-400/30",
    chip: "border-rose-400/45 bg-rose-500/15 text-rose-200",
    accent: "text-rose-200",
  },
  narration: {
    border: "border-emerald-400/30",
    chip: "border-emerald-400/45 bg-emerald-500/15 text-emerald-200",
    accent: "text-emerald-200",
  },
};

const usd = (value: number) => `$${value.toFixed(2)}`;

function StageCard({
  tone,
  step,
  title,
  provider,
  callRule,
  calls,
  unitCostUsd,
  totalCostUsd,
  sends,
  receives,
  testId,
}: {
  tone: StageTone;
  step: number;
  title: string;
  provider: string;
  callRule: string;
  calls: number;
  unitCostUsd: number;
  totalCostUsd: number;
  sends: string[];
  receives: string;
  testId: string;
}) {
  const style = STAGE_STYLES[tone];
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={`space-y-3 rounded-2xl border ${style.border} bg-slate-900/70 p-5`}
    >
      <header className="flex flex-wrap items-center gap-2.5">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${style.chip}`}>{step}단계</span>
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        <span className="text-xs text-slate-500">{provider}</span>
      </header>

      <dl className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <dt className="text-xs text-slate-400">호출 횟수</dt>
          <dd data-testid={`${testId}-calls`} className={`mt-0.5 text-lg font-semibold tabular-nums ${style.accent}`}>
            {calls}회
          </dd>
          <p className="mt-1 text-xs text-slate-500">{callRule}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <dt className="text-xs text-slate-400">1회당 비용</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-200">{usd(unitCostUsd)}</dd>
          <p className="mt-1 text-xs text-slate-500">예상 기준값</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
          <dt className="text-xs text-slate-400">이 단계 합계</dt>
          <dd data-testid={`${testId}-cost`} className={`mt-0.5 text-lg font-semibold tabular-nums ${style.accent}`}>
            {usd(totalCostUsd)}
          </dd>
          <p className="mt-1 text-xs text-slate-500">
            {calls}회 × {usd(unitCostUsd)}
          </p>
        </div>
      </dl>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold text-slate-300">보내는 것</p>
          <ul className="mt-1.5 space-y-1">
            {sends.map((item) => (
              <li key={item} className="text-xs leading-relaxed text-slate-400">
                · {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold text-slate-300">받는 것</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{receives}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * The pipeline drawn as a row of boxes instead of described in a paragraph. The order of the stages is the one
 * thing every question about this app comes back to ("why is my image ignoring the setting I changed?"), and a
 * picture answers it in one glance where the prose below took four.
 */
function PipelineDiagram({ steps, testId }: { steps: { icon: string; title: string; note: string; tone: StageTone | "local" }[]; testId: string }) {
  const toneClass = (tone: StageTone | "local") =>
    tone === "local"
      ? "border-white/15 bg-slate-800/50 text-slate-300"
      : `${STAGE_STYLES[tone].border} bg-slate-900/70 ${STAGE_STYLES[tone].accent}`;
  return (
    <ol data-testid={testId} className="flex flex-wrap items-stretch gap-1.5">
      {steps.map((step, index) => (
        <li key={step.title} className="flex items-stretch gap-1.5">
          <div className={`flex w-28 flex-col items-center rounded-xl border px-2 py-2.5 text-center ${toneClass(step.tone)}`}>
            <span aria-hidden="true" className="text-xl leading-none">{step.icon}</span>
            <span className="mt-1 text-xs font-semibold leading-tight">{step.title}</span>
            <span className="mt-0.5 text-[10px] leading-tight text-slate-500">{step.note}</span>
          </div>
          {index < steps.length - 1 && (
            <span aria-hidden="true" className="self-center text-slate-600">→</span>
          )}
        </li>
      ))}
    </ol>
  );
}

const SHORT_STEPS: { icon: string; title: string; note: string; tone: StageTone | "local" }[] = [
  { icon: "📝", title: "설정 입력", note: "내가 적는 것", tone: "local" },
  { icon: "🤖", title: "대본", note: "OpenAI · 1회", tone: "story" },
  { icon: "🖼", title: "장면 이미지", note: "OpenAI · 장면마다", tone: "image" },
  { icon: "🎬", title: "영상 클립", note: "Runway · 장면마다", tone: "video" },
  { icon: "📼", title: "합치기", note: "내 컴퓨터 · 무료", tone: "local" },
];

const LONG_STEPS: { icon: string; title: string; note: string; tone: StageTone | "local" }[] = [
  { icon: "📚", title: "작품 설정", note: "내가 적는 것", tone: "local" },
  { icon: "🗺", title: "전체 개요", note: "OpenAI · 1회", tone: "story" },
  { icon: "📄", title: "회차 설정", note: "내가 고침 · 무료", tone: "local" },
  { icon: "🤖", title: "회차 대본", note: "OpenAI · 회차마다", tone: "story" },
  { icon: "🖼", title: "장면 이미지", note: "OpenAI · 장면마다", tone: "image" },
  { icon: "🎬", title: "영상 클립", note: "Runway · 장면마다", tone: "video" },
  { icon: "📼", title: "합치기", note: "내 컴퓨터 · 무료", tone: "local" },
];

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-1 py-0.5">
      <span aria-hidden="true" className="text-slate-600">
        ↓
      </span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

/**
 * A read-only explainer for the fixed three-stage pipeline: what runs in what order, how many provider
 * calls each stage makes for the current scene count, and what that costs. Deliberately provider-free —
 * it never calls anything, it only describes what the other screens will do.
 */
export function WorkflowGuideScreen({ onBack }: Props) {
  const [sceneCount, setSceneCount] = useState(6);
  const [clipDurationSeconds, setClipDurationSeconds] = useState<RunwayClipDurationSeconds>(5);
  /** Short is the default so the screen opens on the simpler of the two. */
  const [projectKind, setProjectKind] = useState<"short" | "long">("short");
  const [episodeCount, setEpisodeCount] = useState(5);
  const [narrationEnabled, setNarrationEnabled] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);

  const storyCalls = 1;
  const imageCalls = sceneCount;
  const videoCalls = sceneCount;
  // Narration is opt-in per project, so it must not inflate the projection for projects that leave it off.
  const narrationCalls = narrationEnabled ? sceneCount : 0;
  const storyTotal = storyCalls * STORY_ESTIMATED_COST_USD;
  const imageTotal = imageCalls * IMAGE_ESTIMATED_COST_USD;
  const videoTotal = videoCalls * VIDEO_SCENE_ESTIMATED_COST_USD;
  const narrationTotal = narrationCalls * TTS_ESTIMATED_COST_USD;
  const totalCalls = storyCalls + imageCalls + videoCalls + narrationCalls;
  const totalCost = storyTotal + imageTotal + videoTotal + narrationTotal;
  const runtimeSeconds = sceneCount * clipDurationSeconds;

  // Long projects pay for the whole-work outline once, then repeat the short-project pipeline per episode.
  const longPerEpisodeCalls = 1 + imageCalls + videoCalls + narrationCalls;
  const longPerEpisodeCost = STORY_ESTIMATED_COST_USD + imageTotal + videoTotal + narrationTotal;
  const longTotalCalls = 1 + episodeCount * longPerEpisodeCalls;
  const longTotalCost = LONG_OUTLINE_ESTIMATED_COST_USD + episodeCount * longPerEpisodeCost;
  const longRuntimeSeconds = episodeCount * runtimeSeconds;

  const sceneOptions = Array.from(
    { length: MAX_SCENE_COUNT - MIN_SCENE_COUNT + 1 },
    (_, offset) => MIN_SCENE_COUNT + offset,
  );

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <header className="space-y-1.5">
        <button type="button" className="text-xs text-slate-400 hover:text-slate-300" onClick={onBack}>
          <span aria-hidden="true">←</span> 프로젝트 목록으로
        </button>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          작업 워크플로우
        </h1>
      </header>
      <p className="text-sm leading-relaxed text-slate-400">
        영상 하나가 만들어지기까지 AI를 순서대로 나눠 부릅니다. 아래에서 조건을 바꾸면 실제로 몇 번 호출되고 비용이 얼마나
        드는지 바로 계산됩니다.
      </p>

      {/* The two project kinds run different pipelines and were explained as one, so the long-project flow
          (a whole-work outline first, then the short pipeline repeated per episode) was nowhere on screen. */}
      <div role="tablist" aria-label="프로젝트 종류" className="flex gap-2">
        {([["short", "단기 프로젝트"], ["long", "장기 프로젝트"]] as const).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={projectKind === kind}
            data-testid={`workflow-guide-kind-${kind}`}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              projectKind === kind
                ? "border-violet-400/50 bg-violet-500/15 font-semibold text-violet-200"
                : "border-white/10 text-slate-400 hover:bg-white/5"
            }`}
            onClick={() => setProjectKind(kind)}
          >
            {label}
          </button>
        ))}
      </div>

      <section aria-label="전체 흐름 그림" className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <h2 className="text-sm font-semibold text-slate-200">
          {projectKind === "short" ? "단기 프로젝트 — 영상 하나" : "장기 프로젝트 — 여러 회차"}
        </h2>
        <PipelineDiagram
          testId={`workflow-guide-diagram-${projectKind}`}
          steps={projectKind === "short" ? SHORT_STEPS : LONG_STEPS}
        />
        <p className="text-xs text-slate-500">
          {projectKind === "short"
            ? "왼쪽에서 오른쪽으로 한 번만 지나갑니다. 내가 적은 설정은 대본 AI에게만 가고, 그림과 영상은 대본이 정리한 결과를 받습니다."
            : "전체 개요는 맨 앞에서 딱 한 번입니다. 그 뒤 회차마다 오른쪽 네 칸(회차 대본 → 이미지 → 영상 → 합치기)이 반복됩니다."}
        </p>
      </section>

      {projectKind === "long" && (
        <section aria-label="장기 프로젝트 계산" data-testid="workflow-guide-long" className="space-y-3 rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] p-5">
          <h2 className="text-sm font-semibold text-slate-200">회차 수를 곱하면 이렇게 됩니다</h2>
          <label className="text-sm text-slate-300" htmlFor="workflow-guide-episode-count">
            회차 수
            <select
              id="workflow-guide-episode-count"
              className="ml-2 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none"
              value={episodeCount}
              onChange={(event) => setEpisodeCount(Number(event.target.value))}
            >
              {[3, 5, 8, 10, 12, 20].map((count) => (
                <option key={count} value={count}>{count}화</option>
              ))}
            </select>
            <span className="ml-2 text-xs text-slate-500">장면 수·길이·음성은 아래 조건을 따릅니다</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
              <p className="text-xs text-slate-400">맨 앞 전체 개요</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-violet-200">1회 · {usd(LONG_OUTLINE_ESTIMATED_COST_USD)}</p>
              <p className="mt-1 text-xs text-slate-500">회차가 몇 개든 한 번뿐입니다</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
              <p className="text-xs text-slate-400">회차 하나당</p>
              <p data-testid="workflow-guide-long-per-episode" className="mt-0.5 text-lg font-semibold tabular-nums text-slate-200">
                {longPerEpisodeCalls}회 · {usd(longPerEpisodeCost)}
              </p>
              <p className="mt-1 text-xs text-slate-500">대본 1 + 이미지 {imageCalls} + 영상 {videoCalls}{narrationEnabled ? ` + 음성 ${narrationCalls}` : ""}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
              <p className="text-xs text-slate-400">{episodeCount}화 전체</p>
              <p data-testid="workflow-guide-long-total" className="mt-0.5 text-lg font-semibold tabular-nums text-violet-200">
                {longTotalCalls}회 · {usd(longTotalCost)}
              </p>
              <p className="mt-1 text-xs text-slate-500">완성 길이 {longRuntimeSeconds}초</p>
            </div>
          </div>
          <ul className="space-y-1 text-xs text-slate-400">
            <li>· <span className="text-slate-300">회차 설정을 고치는 건 무료입니다.</span> AI를 부르지 않습니다 — 대본을 만들기 전에 고쳐두는 편이 쌉니다.</li>
            <li>· <span className="text-slate-300">회차는 한꺼번에 안 만들어집니다.</span> 한 회차씩 대본 → 이미지 → 영상 순으로 진행하고, 중간에 멈춰도 다음에 이어서 하면 됩니다.</li>
            <li>· <span className="text-slate-300">아래 단계 설명은 회차 하나 기준입니다.</span> 단기 프로젝트 한 편을 만드는 것과 같은 흐름이 회차마다 반복됩니다.</li>
          </ul>
        </section>
      )}

      <section aria-label="계산 조건" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <h2 className="text-sm font-semibold text-slate-200">계산 조건{projectKind === "long" ? " (회차 하나 기준)" : ""}</h2>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm text-slate-300" htmlFor="workflow-guide-scene-count">
            장면 수
            <select
              id="workflow-guide-scene-count"
              className="ml-2 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none"
              value={sceneCount}
              onChange={(event) => setSceneCount(Number(event.target.value))}
            >
              {sceneOptions.map((count) => (
                <option key={count} value={count}>
                  {count}장면
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300" htmlFor="workflow-guide-clip-duration">
            장면당 길이
            <select
              id="workflow-guide-clip-duration"
              className="ml-2 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none"
              value={clipDurationSeconds}
              onChange={(event) => setClipDurationSeconds(Number(event.target.value) as RunwayClipDurationSeconds)}
            >
              {RUNWAY_CLIP_DURATIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds}초
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-2.5 text-sm text-slate-300">
          <input
            type="checkbox"
            data-testid="workflow-guide-narration"
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-violet-500"
            checked={narrationEnabled}
            onChange={(event) => setNarrationEnabled(event.target.checked)}
          />
          <span>
            음성 넣기
            <span className="mt-0.5 block text-xs text-slate-500">
              프로젝트 설정의 "음성 넣기"와 같은 항목입니다. 켜면 음성 단계가 하나 늘어납니다.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-slate-300">
          <input
            type="checkbox"
            data-testid="workflow-guide-subtitles"
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-violet-500"
            checked={subtitlesEnabled}
            onChange={(event) => setSubtitlesEnabled(event.target.checked)}
          />
          <span>
            자막 넣기
            <span className="mt-0.5 block text-xs text-slate-500">
              자막은 AI를 부르지 않고 이 컴퓨터에서 직접 입힙니다 — 호출 횟수도 비용도 늘지 않습니다.
            </span>
          </span>
        </label>
        <p className="text-xs text-slate-500">
          완성 영상 길이: <span className="tabular-nums text-slate-300">{runtimeSeconds}초</span>
        </p>
      </section>

      <section
        aria-label="전체 요약"
        data-testid="workflow-guide-summary"
        className="grid gap-3 rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] p-5 sm:grid-cols-2"
      >
        <div>
          <p className="text-xs text-slate-400">AI 호출 총 횟수{projectKind === "long" ? " (회차 하나)" : ""}</p>
          <p data-testid="workflow-guide-total-calls" className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-100">
            {totalCalls}회
          </p>
          <p className="mt-1 text-xs text-slate-500">
            대본 {storyCalls}회 + 이미지 {imageCalls}회 + 영상 {videoCalls}회
            {narrationEnabled ? ` + 음성 ${narrationCalls}회` : ""}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">예상 총 비용{projectKind === "long" ? " (회차 하나)" : ""}</p>
          <p data-testid="workflow-guide-total-cost" className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-100">
            {usd(totalCost)}
          </p>
          <p className="mt-1 text-xs text-slate-500">재시도 없이 한 번에 완주했을 때</p>
        </div>
      </section>

      <StageCard
        tone="story"
        step={1}
        title="대본 AI"
        provider="OpenAI"
        callRule="장면 수와 무관하게 프로젝트당 1회"
        calls={storyCalls}
        unitCostUsd={STORY_ESTIMATED_COST_USD}
        totalCostUsd={storyTotal}
        testId="workflow-guide-stage-story"
        sends={[
          "내가 입력한 프로젝트 설정 (주제·줄거리·장르·분위기·세계관)",
          "내가 입력한 스타일 설정 (그림체·색감·조명·카메라)",
          "이미지 보관함의 폴더 공통 특징과 이미지별 개별 특징 (글로 변환)",
        ]}
        receives={
          `장면 ${sceneCount}개분의 구성 정보를 한 번에. 장면마다 구도·모션·대본이 항목별로 나뉘어 돌아옵니다.` +
          (narrationEnabled || subtitlesEnabled ? " 음성이나 자막을 켰으므로 장면마다 읽어줄 문장도 함께 만들어집니다." : "")
        }
      />

      <FlowArrow label="대본 AI가 만든 항목이 이미지용과 영상용으로 갈라집니다" />

      <StageCard
        tone="image"
        step={2}
        title="이미지 AI"
        provider="OpenAI"
        callRule="장면 1개당 1회"
        calls={imageCalls}
        unitCostUsd={IMAGE_ESTIMATED_COST_USD}
        totalCostUsd={imageTotal}
        testId="workflow-guide-stage-image"
        sends={[
          "대본 AI가 만든 구도 항목 (행동·샷 크기·앵글·구도·렌즈·초점)",
          "프로젝트 스타일 설정 (모든 장면에 똑같이 붙어 그림체를 통일합니다)",
          "참고 이미지 연결에서 확정한 참고 이미지 파일 (최대 16장)",
        ]}
        receives="장면마다 정지 이미지 1장. 검토 화면에서 확정해야 다음 단계로 넘어갑니다."
      />

      <FlowArrow label="확정한 이미지가 영상의 첫 프레임이 됩니다" />

      <StageCard
        tone="video"
        step={3}
        title="영상 AI"
        provider="Runway"
        callRule="장면 1개당 1회"
        calls={videoCalls}
        unitCostUsd={VIDEO_SCENE_ESTIMATED_COST_USD}
        totalCostUsd={videoTotal}
        testId="workflow-guide-stage-video"
        sends={[
          "대본 AI가 만든 모션 항목 (시작·주요·마무리 동작, 표정 변화, 카메라, 배경 움직임, 속도)",
          "앞 장면과 이어지도록 하는 연속성 힌트",
          "확정한 장면 이미지 1장 (첫 프레임)",
        ]}
        receives={
          `장면마다 ${clipDurationSeconds}초 영상 1개. 검토 후 확정하면 마지막에 하나로 병합됩니다.` +
          (narrationEnabled && subtitlesEnabled
            ? " 병합할 때 내레이션 음성과 자막이 함께 입혀집니다."
            : narrationEnabled
              ? " 병합할 때 내레이션 음성이 입혀집니다."
              : subtitlesEnabled
                ? " 병합할 때 자막이 입혀집니다(비용 없음)."
                : "")
        }
      />

      {narrationEnabled && (
        <>
          <FlowArrow label="내레이션을 켜면 음성 단계가 하나 더 붙습니다" />
          <StageCard
            tone="narration"
            step={4}
            title="음성 AI"
            provider="OpenAI TTS"
            callRule="장면 1개당 1회"
            calls={narrationCalls}
            unitCostUsd={TTS_ESTIMATED_COST_USD}
            totalCostUsd={narrationTotal}
            testId="workflow-guide-stage-narration"
            sends={[
              "대본 AI가 만든 장면별 내레이션 문장",
              "새 계정이나 새 키가 필요하지 않습니다 — 이미 연결한 OpenAI 키를 그대로 씁니다",
            ]}
            receives="장면마다 읽어주는 음성 1개. 마지막 병합 단계에서 영상에 음성과 자막으로 입혀집니다."
          />
        </>
      )}

      <section aria-label="알아두면 좋은 것" className="space-y-2.5 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <h2 className="text-sm font-semibold text-slate-200">알아두면 좋은 것</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-slate-400">
          <li>
            · <span className="text-slate-300">API 키를 연결하지 않으면 비용이 들지 않습니다.</span> 키가 없으면 실제
            호출 없이 임시 결과로 동작하므로, 흐름을 익힐 때는 키 없이 돌려봐도 됩니다.
          </li>
          <li>
            · <span className="text-slate-300">재시도는 비용이 다시 듭니다.</span> 마음에 안 드는 장면 하나를 다시
            뽑으면 그 장면의 1회 비용이 추가로 발생합니다.
          </li>
          <li>
            · <span className="text-slate-300">내가 입력한 설정은 대본 AI에게만 전달됩니다.</span> 이미지·영상 AI는 내
            입력이 아니라 대본 AI가 장면별로 정리한 결과를 받습니다. 그래서 설정을 바꾸면 대본부터 다시 만들어야 그림과
            영상까지 반영됩니다.
          </li>
          <li>
            · <span className="text-slate-300">음성과 자막은 따로 켤 수 있습니다.</span> 자막만 켜면 AI 호출이 늘지 않아
            비용 없이 글자만 얹을 수 있고, 음성을 켜면 그때부터 장면마다 비용이 붙습니다. 음성은 등장인물이 입을 움직여
            말하는 방식이 아니라 이야기를 읽어주는 방식이라, 입 모양이 어긋나 보이지 않습니다.
          </li>
          <li>
            · <span className="text-slate-300">위 금액은 예상치입니다.</span> 실제 청구는 각 제공사 기준을 따르며, 월
            한도에 걸리면 요청을 보내기 전에 미리 막힙니다.
          </li>
        </ul>
      </section>
    </section>
  );
}
