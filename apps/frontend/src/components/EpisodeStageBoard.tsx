import type { LongEpisodeStatus } from "@ai-animation-studio/shared";

import { longEpisodeStatusesAtOrAfter } from "../utils/longEpisodeLabels.js";

export const BOARD_STAGES = ["outline", "script", "images", "video", "merge"] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];
export type BoardCellState = "done" | "current" | "upcoming" | "unknown";
/** 회차 전체가 멈춘 상태 — 어느 단계에서 멈췄는지는 계약에 없어서 칸이 아니라 행에 붙입니다. */
export type BoardStopState = "interrupted" | "failed";

const STAGE_LABEL: Record<BoardStage, string> = { outline: "개요", script: "대본", images: "이미지", video: "영상", merge: "병합" };
const CELL_LABEL: Record<BoardCellState, string> = { done: "완료", current: "지금 할 차례", upcoming: "아직", unknown: "확인 필요" };
const STOP_LABEL: Record<BoardStopState, string> = { interrupted: "중단됨", failed: "실패" };
const STOP_NOTE = "멈춘 단계는 기록돼 있지 않습니다";

/** 각 단계를 「마친」 상태들 — 기존 단계 누계와 같은 유틸(`longEpisodeStatusesAtOrAfter`)을 씁니다. */
const DONE: Record<Exclude<BoardStage, "merge">, ReadonlySet<LongEpisodeStatus>> = {
  outline: longEpisodeStatusesAtOrAfter("outline_ready"),
  script: longEpisodeStatusesAtOrAfter("script_approved"),
  images: longEpisodeStatusesAtOrAfter("waiting_for_video_confirmation"),
  video: longEpisodeStatusesAtOrAfter("videos_approved"),
};

/** 지금 이어갈 단계 — 상세 화면의 「이어하기」(episodeResumeTarget)와 같은 갈래입니다. 모두 끝났으면 null. */
function currentStage(status: LongEpisodeStatus): BoardStage | null {
  switch (status) {
    case "planned": case "outline_ready": return status === "planned" ? "outline" : "script";
    case "script_review": return "script";
    case "script_approved": case "waiting_for_asset_mapping_review": case "asset_mapping_approved":
    case "generating_images": case "images_ready": case "images_review": return "images";
    case "waiting_for_video_confirmation": case "videos_generating": case "videos_ready": case "videos_review": return "video";
    case "videos_approved": case "rendering": return "merge";
    case "completed": case "interrupted": case "failed": return null;
    default: {
      // 계약에 상태가 늘면 여기서 컴파일 오류 — 보드가 조용히 빈 칸을 그리지 않게.
      const unhandled: never = status;
      return unhandled ?? null;
    }
  }
}

/** 회차가 멈춘 상태면 그 종류, 아니면 null. */
export function episodeStopState(status: LongEpisodeStatus): BoardStopState | null {
  return status === "interrupted" || status === "failed" ? status : null;
}

/**
 * 한 회차의 다섯 칸(개요·대본·이미지·영상·병합) 상태.
 *
 * 🔴 `interrupted`·`failed` 는 줄 위의 점이 아니라 「어디서든 멈춘」 상태이고(shared `LONG_EPISODE_STATUSES` 주석), 저장된
 * 상태 하나로는 어느 단계에서 멈췄는지 알 수 없습니다 — 백엔드는 이미지·영상·병합·고아 작업 복구 어디서든 이 값을 씁니다. 그래서
 * 다섯 칸 모두 「확인 필요」로 두고 완료를 단정하지 않으며, 멈춘 사실은 행(`episodeStopState`)에 적습니다(CLI 1337). 이어하기가
 * 그 회차를 어느 화면으로 보내는지는 재개 진입점일 뿐 실패 단계의 근거가 아닙니다.
 */
export function episodeStageCells(status: LongEpisodeStatus): Record<BoardStage, BoardCellState> {
  if (episodeStopState(status) !== null) {
    return Object.fromEntries(BOARD_STAGES.map((stage) => [stage, "unknown"])) as Record<BoardStage, BoardCellState>;
  }
  const current = currentStage(status);
  const currentIndex = current === null ? BOARD_STAGES.length : BOARD_STAGES.indexOf(current);
  const cells = {} as Record<BoardStage, BoardCellState>;
  BOARD_STAGES.forEach((stage, index) => {
    if (status === "completed") { cells[stage] = "done"; return; }
    if (index < currentIndex) { cells[stage] = "done"; return; }
    if (index > currentIndex) { cells[stage] = "upcoming"; return; }
    cells[stage] = "current";
  });
  // 줄 위 상태는 「마친 상태」 집합과도 맞아야 합니다 — 어긋나면 보수적으로 「지금 할 차례」로 둡니다.
  if (status !== "completed") {
    (Object.keys(DONE) as Exclude<BoardStage, "merge">[]).forEach((stage) => {
      if (cells[stage] === "done" && !DONE[stage].has(status)) cells[stage] = "current";
    });
  }
  return cells;
}

const CELL_TONE: Record<BoardCellState, string> = {
  done: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  current: "border-violet-400/50 bg-violet-500/15 text-bone",
  upcoming: "border-line text-bone-faint",
  unknown: "border-dashed border-line text-bone-faint",
};

const STOP_TONE: Record<BoardStopState, string> = {
  interrupted: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  failed: "border-rose-400/40 bg-rose-500/10 text-rose-300",
};

interface BoardEpisode { episodeNumber: number; title: string; status: LongEpisodeStatus }

interface Props {
  episodes: BoardEpisode[];
  /** 칸을 누르면 그 회차의 그 단계 화면으로 **이동만** 합니다 — 새 생성·유료 요청을 시작하지 않습니다. */
  onOpenStage: (stage: BoardStage, episode: BoardEpisode) => void;
}

/**
 * 회차 × 단계 보드(M4-2) — 행은 회차, 열은 개요·대본·이미지·영상·병합. 각 칸이 그 단계의 상태와 「지금 이어갈 곳」을 한눈에 보여
 * 주고, 누르면 기존 회차 화면으로 이동합니다. 아직 닿지 않은 단계(「아직」)는 버튼이 아닙니다. 좁은 화면에서는 가로로 스크롤합니다.
 */
export function EpisodeStageBoard({ episodes, onOpenStage }: Props) {
  if (episodes.length === 0) {
    return <p data-testid="episode-board-empty" className="text-sm text-slate-400">아직 회차가 없습니다. 「회차 나누기(AI)」로 회차를 만들면 여기에 단계가 보입니다.</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid="episode-board">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-left text-xs">
        <caption className="sr-only">회차별 단계 상태 — 칸을 누르면 그 회차의 그 단계 화면으로 이동합니다. 중단·실패한 회차는 멈춘 단계가 기록돼 있지 않아 칸을 「확인 필요」로 둡니다</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 font-medium text-bone-faint">회차</th>
            {BOARD_STAGES.map((stage) => <th key={stage} scope="col" className="px-2 py-1 font-medium text-bone-faint">{STAGE_LABEL[stage]}</th>)}
          </tr>
        </thead>
        <tbody>
          {episodes.map((episode) => {
            const cells = episodeStageCells(episode.status);
            const stop = episodeStopState(episode.status);
            return (
              <tr key={episode.episodeNumber} data-testid={`episode-board-row-${episode.episodeNumber}`} data-stop-state={stop ?? undefined}>
                <th scope="row" className="max-w-[14rem] px-2 py-1 font-medium text-bone">
                  <span className="block truncate">{episode.episodeNumber}회 · {episode.title}</span>
                  {stop && (
                    <span data-testid={`episode-board-${episode.episodeNumber}-stop`} className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[11px] font-normal ${STOP_TONE[stop]}`}>
                      {STOP_LABEL[stop]} — {STOP_NOTE}
                    </span>
                  )}
                </th>
                {BOARD_STAGES.map((stage) => {
                  const state = cells[stage];
                  const testId = `episode-board-${episode.episodeNumber}-${stage}`;
                  const className = `block w-full rounded border px-2 py-1.5 text-center ${CELL_TONE[state]}`;
                  return (
                    <td key={stage}>
                      {state === "upcoming"
                        ? <span data-testid={testId} data-cell-state={state} className={className}>{CELL_LABEL[state]}</span>
                        : (
                          <button
                            type="button"
                            data-testid={testId}
                            data-cell-state={state}
                            className={`${className} hover:border-violet-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30`}
                            aria-label={`${episode.episodeNumber}회 ${STAGE_LABEL[stage]}: ${CELL_LABEL[state]}${stop ? `(${STOP_LABEL[stop]} — ${STOP_NOTE})` : ""} — 화면 열기`}
                            onClick={() => onOpenStage(stage, episode)}
                          >
                            {CELL_LABEL[state]}
                          </button>
                        )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
