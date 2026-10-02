import { useEffect, useRef, useState } from "react";
import { STILL_MOTIONS, type PhotoCardSubtitleLayout, type SceneNumber, type StillMotion } from "@ai-animation-studio/shared";

import { previewStillMotion, toVideoMergeDisplayError } from "../api/videoMergeApi.js";
import { sceneImageContentUrl } from "../api/videoWorkflowApi.js";
import { Spinner } from "./Spinner.js";

/**
 * 멈춘 그림 릴(명언 카드·뉴스 릴)에서 **사진마다 움직임을 고르고 한 장씩 미리 보는** 칸(CLI Round 1147·1148).
 *
 * 예전엔 모든 사진이 가운데로 15% 확대(`zoom_in`)뿐이었습니다. 옛 프로젝트는 서버가 전부 `zoom_in` 으로 돌려주니
 * 아무것도 안 고르면 결과가 예전과 같습니다.
 *
 * 🟠 미리보기는 **최종 합성과 같은 FFmpeg 경로**로 사진 한 장의 전체 길이를 굽습니다 — 그래서 몇 초 걸립니다.
 * 굽는 동안 다른 미리보기 단추는 닫습니다(연속 클릭이 같은 컴퓨터에 렌더를 쌓지 않게). 글자·뉴스 띠는 고정이고
 * 소리는 없습니다 — 그 두 가지를 화면이 말합니다.
 */
export const STILL_MOTION_LABELS: Record<StillMotion, string> = {
  zoom_in: "천천히 확대 (지금까지의 기본)",
  zoom_out: "천천히 축소",
  pan_left: "왼쪽으로 이동",
  pan_right: "오른쪽으로 이동",
  still: "움직이지 않음",
};

interface Props {
  projectId: string;
  motions: StillMotion[];
  onChange: (index: number, motion: StillMotion) => void;
  /** 명언 카드만: 아직 저장 안 한 자막 크기·위치를 미리보기에 같이 싣습니다. 뉴스 릴은 넘기지 않습니다. */
  subtitleLayout?: PhotoCardSubtitleLayout;
  disabled?: boolean;
}

type Preview =
  | { status: "idle" }
  | { status: "rendering"; index: number }
  | { status: "ready"; index: number; motion: StillMotion; url: string; layoutKey: string }
  | { status: "error"; index: number; message: string };

export function StillMotionFieldset({ projectId, motions, onChange, subtitleLayout, disabled = false }: Props) {
  const [preview, setPreview] = useState<Preview>({ status: "idle" });
  /* 지금 들고 있는 Blob 주소 — 바꿀 때와 화면을 떠날 때 반드시 놓습니다. 안 놓으면 미리보기 한 번마다 영상 한 편이
     메모리에 남습니다. */
  const urlRef = useRef<string | null>(null);
  const releaseUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };
  /* 굽는 중에 화면을 떠나면 응답이 늦게 와도 Blob 주소를 만들지 않습니다(만들면 놓을 주인이 없습니다 — CLI Round 1151). */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; releaseUrl(); };
  }, []);
  /* 미리보기에 실은 자막 크기·위치 — 그 뒤 슬라이더를 움직이면 미리보기가 낡았다고 말하려고 기억합니다. */
  const layoutKey = subtitleLayout ? `${subtitleLayout.scale}|${subtitleLayout.center}` : "";

  const rendering = preview.status === "rendering";

  async function showPreview(index: number): Promise<void> {
    if (rendering) return;
    const motion = motions[index]!;
    const requestedLayoutKey = layoutKey;
    releaseUrl();
    setPreview({ status: "rendering", index });
    try {
      const blob = await previewStillMotion(projectId, {
        sceneNumber: (index + 1) as SceneNumber,
        motion,
        ...(subtitleLayout ? { subtitleLayout } : {}),
      });
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPreview({ status: "ready", index, motion, url, layoutKey: requestedLayoutKey });
    } catch (caught) {
      if (!mounted.current) return;
      setPreview({ status: "error", index, message: toVideoMergeDisplayError(caught).message });
    }
  }

  return (
    <fieldset data-testid="merge-still-motion" className="space-y-3 rounded-lg border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-100">사진 움직임</legend>
      <p className="text-xs text-slate-400">
        사진마다 움직임을 고를 수 있습니다. 글자{subtitleLayout ? "" : "와 뉴스 띠"}는 움직이지 않습니다. 「미리보기」는 이 컴퓨터에서 사진 한 장만 구워 보여 주며 비용이 들지 않습니다.
      </p>
      <ol className="space-y-2">
        {motions.map((motion, index) => {
          const sceneNumber = index + 1;
          const isPreviewing = preview.status !== "idle" && preview.index === index;
          return (
            <li key={sceneNumber} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-2">
              <img
                src={sceneImageContentUrl(projectId, sceneNumber)}
                alt={`사진 ${sceneNumber}`}
                loading="lazy"
                className="h-14 w-10 flex-shrink-0 rounded-lg border border-white/10 bg-slate-800 object-cover"
              />
              <label className="min-w-0 flex-1 text-xs text-slate-400" htmlFor={`still-motion-${sceneNumber}`}>
                <span className="block text-sm font-semibold text-slate-100 tabular-nums">사진 {sceneNumber}</span>
                <select
                  id={`still-motion-${sceneNumber}`}
                  data-testid={`merge-still-motion-${sceneNumber}`}
                  className="mt-1 block w-full rounded-xl border border-white/10 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
                  value={motion}
                  disabled={disabled}
                  onChange={(event) => onChange(index, event.target.value as StillMotion)}
                >
                  {STILL_MOTIONS.map((value) => (
                    <option key={value} value={value}>{STILL_MOTION_LABELS[value]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                data-testid={`merge-still-motion-preview-${sceneNumber}`}
                className="flex-shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                disabled={disabled || rendering}
                onClick={() => void showPreview(index)}
              >
                {rendering && isPreviewing ? "굽는 중..." : "미리보기"}
              </button>
            </li>
          );
        })}
      </ol>
      {preview.status === "rendering" && <Spinner label={`사진 ${preview.index + 1} 미리보기를 굽는 중... (몇 초 걸립니다)`} />}
      {preview.status === "error" && (
        <p role="alert" data-testid="merge-still-motion-preview-error" className="text-xs text-rose-400">
          사진 {preview.index + 1} 미리보기를 만들지 못했습니다 — {preview.message}
        </p>
      )}
      {preview.status === "ready" && (
        <div className="space-y-1.5" data-testid="merge-still-motion-preview">
          <p className="text-xs text-slate-400">
            사진 {preview.index + 1} · {STILL_MOTION_LABELS[preview.motion]} — 소리 없는 미리보기입니다.
            {motions[preview.index] !== preview.motion && <span className="text-amber-300"> 그 뒤로 움직임을 바꾸셨습니다 — 다시 눌러 보세요.</span>}
            {motions[preview.index] === preview.motion && preview.layoutKey !== layoutKey && (
              <span data-testid="merge-still-motion-preview-stale-layout" className="text-amber-300"> 그 뒤로 자막 크기·위치를 바꾸셨습니다 — 다시 눌러 보세요.</span>
            )}
          </p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a silent local preview, nothing to caption */}
          <video
            data-testid="merge-still-motion-player"
            src={preview.url}
            className="w-full max-w-[12rem] rounded-xl border border-white/10 bg-slate-950/60"
            controls
            autoPlay
            muted
            loop
          />
        </div>
      )}
    </fieldset>
  );
}
