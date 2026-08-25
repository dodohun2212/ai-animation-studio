import { useState } from "react";
import { MAX_SCENE_COUNT, MIN_SCENE_COUNT, RUNWAY_CLIP_DURATIONS, type RunwayClipDurationSeconds } from "@ai-animation-studio/shared";

interface Props {
  onBack: () => void;
}

/**
 * Per-call provider cost estimates. These mirror the backend's own budget constants
 * (`STORY_ESTIMATED_COST_USD`/`IMAGE_ESTIMATED_COST_USD` in providers/openai-budget.ts and
 * `VIDEO_SCENE_ESTIMATED_COST_USD` in providers/runway-budget.ts) — the backend remains the single
 * authority that actually reserves and records spend; this screen only explains what will happen.
 * TODO(bridge): swap these for the shared constants once the backend exports them from
 * packages/shared/src/domain.ts, so this screen can never drift from what is actually charged.
 */
const STORY_COST_USD = 0.05;
const IMAGE_COST_USD = 0.1;
const VIDEO_SCENE_COST_USD = 0.25;

type StageTone = "story" | "image" | "video";

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

  const storyCalls = 1;
  const imageCalls = sceneCount;
  const videoCalls = sceneCount;
  const storyTotal = storyCalls * STORY_COST_USD;
  const imageTotal = imageCalls * IMAGE_COST_USD;
  const videoTotal = videoCalls * VIDEO_SCENE_COST_USD;
  const totalCalls = storyCalls + imageCalls + videoCalls;
  const totalCost = storyTotal + imageTotal + videoTotal;
  const runtimeSeconds = sceneCount * clipDurationSeconds;

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
        영상 하나가 만들어지기까지 AI를 세 번에 나눠 부릅니다. 아래에서 장면 수를 바꾸면 실제로 몇 번 호출되고 비용이
        얼마나 드는지 바로 계산됩니다.
      </p>

      <section aria-label="계산 조건" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <h2 className="text-sm font-semibold text-slate-200">계산 조건</h2>
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
          <p className="text-xs text-slate-400">AI 호출 총 횟수</p>
          <p data-testid="workflow-guide-total-calls" className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-100">
            {totalCalls}회
          </p>
          <p className="mt-1 text-xs text-slate-500">
            대본 {storyCalls}회 + 이미지 {imageCalls}회 + 영상 {videoCalls}회
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">예상 총 비용</p>
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
        unitCostUsd={STORY_COST_USD}
        totalCostUsd={storyTotal}
        testId="workflow-guide-stage-story"
        sends={[
          "내가 입력한 프로젝트 설정 (주제·줄거리·장르·분위기·세계관)",
          "내가 입력한 스타일 설정 (그림체·색감·조명·카메라)",
          "Asset Library의 폴더 공통 특징과 이미지별 개별 특징 (글로 변환)",
        ]}
        receives={`장면 ${sceneCount}개분의 구성 정보를 한 번에. 장면마다 구도·모션·대본이 항목별로 나뉘어 돌아옵니다.`}
      />

      <FlowArrow label="대본 AI가 만든 항목이 이미지용과 영상용으로 갈라집니다" />

      <StageCard
        tone="image"
        step={2}
        title="이미지 AI"
        provider="OpenAI"
        callRule="장면 1개당 1회"
        calls={imageCalls}
        unitCostUsd={IMAGE_COST_USD}
        totalCostUsd={imageTotal}
        testId="workflow-guide-stage-image"
        sends={[
          "대본 AI가 만든 구도 항목 (행동·샷 크기·앵글·구도·렌즈·초점)",
          "프로젝트 스타일 설정 (모든 장면에 똑같이 붙어 그림체를 통일합니다)",
          "Asset Mapping에서 확정한 참고 이미지 파일 (최대 16장)",
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
        unitCostUsd={VIDEO_SCENE_COST_USD}
        totalCostUsd={videoTotal}
        testId="workflow-guide-stage-video"
        sends={[
          "대본 AI가 만든 모션 항목 (시작·주요·마무리 동작, 표정 변화, 카메라, 배경 움직임, 속도)",
          "앞 장면과 이어지도록 하는 연속성 힌트",
          "확정한 장면 이미지 1장 (첫 프레임)",
        ]}
        receives={`장면마다 ${clipDurationSeconds}초 영상 1개. 검토 후 확정하면 마지막에 하나로 병합됩니다.`}
      />

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
            · <span className="text-slate-300">위 금액은 예상치입니다.</span> 실제 청구는 각 제공사 기준을 따르며, 월
            한도에 걸리면 요청을 보내기 전에 미리 막힙니다.
          </li>
        </ul>
      </section>
    </section>
  );
}
