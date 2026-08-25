import { useEffect, useRef, useState } from "react";
import type { Project, Scene } from "@ai-animation-studio/shared";
import { TTS_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";

import { getProject, getProjectSettings, toDisplayError } from "../api/projectsApi.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; project: Project };

/**
 * Rough Korean narration reading pace, in characters per second, used only to warn that a line looks too long
 * for its clip. Deliberately conservative (real delivery varies with punctuation, numbers and the chosen voice),
 * and never used to block anything — it flags lines for a human to shorten, it does not decide for them.
 */
const READING_CHARS_PER_SECOND = 5;

const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function narrationOf(scene: Scene): string {
  return typeof scene.narration === "string" ? scene.narration.trim() : "";
}

export function NarrationReviewScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  /**
   * Loaded separately and treated as optional: the clip length only powers a soft "this line looks long"
   * warning, so a settings request that fails must not take the narration text down with it.
   */
  const [clipDurationSeconds, setClipDurationSeconds] = useState<number | null>(null);
  const loadRequest = useRef(0);

  useEffect(() => {
    const requestId = ++loadRequest.current;
    setState({ status: "loading" });
    setClipDurationSeconds(null);
    getProject(projectId)
      .then((response) => {
        if (requestId !== loadRequest.current) return;
        setState({ status: "ready", project: response.project });
      })
      .catch((caught: unknown) => {
        if (requestId !== loadRequest.current) return;
        setState({ status: "error", error: toDisplayError(caught) });
      });
    getProjectSettings(projectId)
      .then((response) => {
        if (requestId !== loadRequest.current) return;
        setClipDurationSeconds(response.settings.clipDurationSeconds);
      })
      .catch(() => {
        // Length warnings are a convenience, not the point of this screen — silently do without them.
      });
  }, [projectId]);

  const scenes = state.status === "ready" ? state.project.scenes : [];
  const withNarration = scenes.filter((scene) => narrationOf(scene));
  const missing = scenes.filter((scene) => !narrationOf(scene));
  const estimatedCost = withNarration.length * TTS_ESTIMATED_COST_USD;
  const overLongScenes = clipDurationSeconds
    ? withNarration.filter((scene) => narrationOf(scene).length > clipDurationSeconds * READING_CHARS_PER_SECOND)
    : [];

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
          내레이션 확인
        </h1>
      </header>
      <p className="text-sm leading-relaxed text-slate-400">
        음성으로 만들어질 문장입니다. 음성 생성은 장면마다 한 번씩 비용이 들기 때문에, 만들기 전에 여기서 먼저 읽어볼 수
        있게 했습니다. 고칠 곳이 있으면 대본을 다시 만들어야 반영됩니다.
      </p>

      {state.status === "loading" && <Spinner label="내레이션을 불러오는 중..." />}
      {state.status === "error" && (
        <p role="alert" data-testid="narration-load-error" data-error-code={state.error.code} className="text-sm text-rose-400">
          {state.error.message}
        </p>
      )}

      {state.status === "ready" && (
        <>
          <section aria-label="내레이션 요약" data-testid="narration-summary" className={cardSection}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-400">내레이션이 있는 장면</p>
                <p data-testid="narration-count" className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-100">
                  {withNarration.length} / {scenes.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">음성 생성 예상 비용</p>
                <p data-testid="narration-estimated-cost" className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-100">
                  ${estimatedCost.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {withNarration.length}장면 × ${TTS_ESTIMATED_COST_USD.toFixed(2)} · 키가 연결되어 있을 때만 청구됩니다
                </p>
              </div>
            </div>
            {missing.length > 0 && (
              <p role="alert" data-testid="narration-missing" className="text-sm text-amber-300">
                {missing.length}개 장면에 내레이션 문장이 없습니다. 내레이션을 켜기 전에 만들어진 대본이라면, 대본을 다시
                만들어야 문장이 생깁니다.
              </p>
            )}
            {overLongScenes.length > 0 && (
              <p role="alert" data-testid="narration-too-long" className="text-sm text-amber-300">
                {overLongScenes.length}개 장면의 문장이 {clipDurationSeconds}초 안에 읽기에 길어 보입니다. 음성이 장면보다
                길어질 수 있으니 줄이는 편이 좋습니다.
              </p>
            )}
          </section>

          {withNarration.length === 0 && missing.length === 0 && (
            <p data-testid="narration-empty" className="text-sm text-slate-400">
              아직 장면이 없습니다. 대본을 먼저 만들어 주세요.
            </p>
          )}

          {scenes.length > 0 && (
            <ul aria-label="장면별 내레이션" className="space-y-2">
              {scenes.map((scene) => {
                const text = narrationOf(scene);
                const tooLong =
                  Boolean(clipDurationSeconds) && text.length > (clipDurationSeconds ?? 0) * READING_CHARS_PER_SECOND;
                return (
                  <li
                    key={scene.number}
                    data-testid={`narration-scene-${scene.number}`}
                    data-has-narration={text ? "true" : "false"}
                    className={`space-y-1.5 rounded-xl border bg-slate-950/40 p-3.5 ${
                      tooLong ? "border-amber-400/40" : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-100">{scene.number}번 장면</span>
                      {text ? (
                        <StatusChip tone={tooLong ? "progress" : "neutral"}>
                          {text.length}자{tooLong ? " · 길 수 있음" : ""}
                        </StatusChip>
                      ) : (
                        <StatusChip tone="danger">문장 없음</StatusChip>
                      )}
                    </div>
                    {text ? (
                      <p className="text-sm leading-relaxed text-slate-300">{text}</p>
                    ) : (
                      <p className="text-sm text-slate-500">이 장면에는 읽어줄 문장이 없어 음성도 만들어지지 않습니다.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
