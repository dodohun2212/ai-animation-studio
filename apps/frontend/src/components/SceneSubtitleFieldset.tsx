import { useLayoutEffect, useRef, useState } from "react";
import type { SceneNumber, SceneSubtitleLayout } from "@ai-animation-studio/shared";
import {
  DEFAULT_SCENE_SUBTITLE_LAYOUT,
  SCENE_SUBTITLE_CENTER,
  SCENE_SUBTITLE_CSS_RATIO,
  SCENE_SUBTITLE_OUTLINE,
  SCENE_SUBTITLE_SCALE,
  SCENE_SUBTITLE_SHADOW,
  sceneSubtitleGeometry,
} from "@ai-animation-studio/shared";

import { sceneImageContentUrl } from "../api/videoWorkflowApi.js";
import { blockOutsideFrame } from "../utils/subtitleOverflow.js";

/** One scene's burned-in line, with the picture it will sit on. */
export interface SubtitledScene {
  number: SceneNumber;
  /** Exactly the string the renderer burns in. A scene with no narration has no subtitle and is not passed here. */
  text: string;
}

interface Props {
  projectId: string;
  scenes: SubtitledScene[];
  vertical: boolean;
  layout: SceneSubtitleLayout;
  onChange: (layout: SceneSubtitleLayout) => void;
  disabled?: boolean;
}

/** The long side of the frame the renderer works in. Sizes are said in these pixels, which is the unit a person can picture. */
const REFERENCE_HEIGHT = 1920;
/** The preview's longest side on screen. The frame is drawn at full size and scaled down to this — see the box below for why. */
const PREVIEW_LONG_SIDE = 420;

const field = "w-full accent-violet-400 disabled:opacity-50";
const label = "flex items-baseline justify-between text-sm text-slate-300";

/**
 * Size and height for the subtitle burned into every scene, with a scene behind it.
 *
 * 캡틴D reported the subtitle as hard to read and sitting too low, and both were already-solved problems on the
 * other path: the photo card was moved off the bottom because that is where Reels draws its own caption, name
 * and buttons, and off a 3px stroke because a thinner edge vanishes into the bright parts of a photograph. The
 * scene branch never got either change. Moving it to a fixed better place would not have been enough — a scene
 * is moving footage, and the place that clears the platform's interface on one shot covers the subject on the
 * next — so this is a handle rather than a new constant.
 *
 * The bounds come from the shared ranges rather than being repeated, so a slider cannot reach a value the merge
 * would refuse.
 */
export function SceneSubtitleFieldset({ projectId, scenes, vertical, layout, onChange, disabled }: Props) {
  /*
   * Drawn at the video's real size and scaled down, not laid out small.
   *
   * A small box wraps a long line at a different place than a 1080-wide frame does, and the number of lines is
   * exactly what decides whether the block still fits — the reason the card's preview does this too. Here it
   * matters more, not less: the shared bounds cannot promise the text stays inside the frame, because the
   * block's height depends on how much text there is, so this measurement is the only thing that closes that
   * hole (see SCENE_SUBTITLE_CENTER's own note, and CLI Round 667's correction of the number I read it from).
   */
  const frameWidth = vertical ? 1080 : 1920;
  const frameHeight = vertical ? 1920 : 1080;
  const width = vertical ? Math.round(PREVIEW_LONG_SIDE * 9 / 16) : PREVIEW_LONG_SIDE;
  const height = vertical ? PREVIEW_LONG_SIDE : Math.round(PREVIEW_LONG_SIDE * 9 / 16);
  const previewScale = width / frameWidth;
  // The renderer's own arithmetic, called rather than copied — a preview that re-implements it is a preview
  // that can be wrong without saying so.
  const g = sceneSubtitleGeometry(frameWidth, frameHeight, layout);
  const atDefault = layout.scale === DEFAULT_SCENE_SUBTITLE_LAYOUT.scale && layout.center === DEFAULT_SCENE_SUBTITLE_LAYOUT.center;

  const [shownIndex, setShownIndex] = useState(0);
  const shown = scenes[Math.min(shownIndex, scenes.length - 1)];

  /*
   * The edge, approximated rather than reproduced. libass strokes a glyph outline; CSS can only stack shadows,
   * so these two cannot draw the same thing and the note under the preview says so. The widths are the
   * renderer's own constants used unchanged — the frame is drawn at full size and scaled at the end, so they
   * shrink with everything else instead of needing their own arithmetic.
   */
  const stroke = SCENE_SUBTITLE_OUTLINE;
  const drop = SCENE_SUBTITLE_SHADOW;
  const shadow = `0 0 ${stroke}px #000, ${drop}px ${drop}px ${stroke * 2}px rgba(0,0,0,0.85), -${stroke}px 0 ${stroke}px #000, ${stroke}px 0 ${stroke}px #000, 0 -${stroke}px ${stroke}px #000, 0 ${stroke}px ${stroke}px #000`;

  /**
   * Which scenes run outside the frame — measured on drawn text, and measured for EVERY scene rather than the
   * one on screen.
   *
   * 🔴 The warning is load-bearing here in a way the card's is not. A card is one line the person typed; a reel
   * is one layout applied to N different sentences, and the longest of them is the one that overflows. A
   * warning that only checked the previewed scene would go quiet on exactly the scene that needed it, which is
   * the shape of defect this whole change exists to remove — a screen saying something that is not true.
   *
   * So every scene's line is laid out in a hidden layer at the same geometry and measured. Hidden with
   * `visibility`, not `display`, because a box that is not laid out has no height to read.
   */
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState<number[]>([]);
  useLayoutEffect(() => {
    const container = measureRef.current;
    if (!container) return;
    let cancelled = false;
    const measure = (): void => {
      if (cancelled) return;
      const blocks = Array.from(container.children) as unknown as { offsetHeight: number; scrollWidth: number; clientWidth: number }[];
      const outside: number[] = [];
      blocks.forEach((node, index) => {
        const scene = scenes[index];
        if (!scene) return;
        // Reading only. The decision is `blockOutsideFrame`, which lives apart because this measurement cannot
        // be tested — jsdom reports 0 for every laid-out height, so a test driving this loop would agree with
        // anything. See that function's own note.
        const outsideFrame = blockOutsideFrame(
          { centerY: g.y, height: node.offsetHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth },
          frameHeight,
        );
        if (outsideFrame) outside.push(scene.number);
      });
      setOverflowing(outside);
    };
    measure();
    /*
     * Measured again once the real face has arrived. The subtitle font is loaded from the backend (styles.css)
     * and a webfont lands after the first paint, so the first measurement is of whatever fallback the machine
     * had — and a warning computed in the wrong face is a warning about the wrong width. `document.fonts` is
     * absent under jsdom, so this is a no-op in tests rather than a failure, and the first measurement stands.
     */
    void document.fonts?.ready.then(measure).catch(() => { /* A face that never loads leaves the first measurement standing, which is the honest floor. */ });
    return () => { cancelled = true; };
  }, [scenes, layout.scale, layout.center, g.y, frameHeight, frameWidth]);

  /** One subtitle block, positioned exactly the way `\an5\pos` positions it: centred on its own centre. */
  function block(text: string, key: string) {
    return (
      <div
        key={key}
        className="absolute left-0 right-0 text-center leading-tight"
        style={{
          top: `${g.y}px`,
          transform: "translateY(-50%)",
          paddingLeft: `${g.margin}px`,
          paddingRight: `${g.margin}px`,
          // ASS Fontsize to CSS font-size. libass sizes a font by its own vertical metrics, so the two units
          // are not the same number for the same drawn width; the ratio is measured off real rendered frames.
          fontSize: `${g.size * SCENE_SUBTITLE_CSS_RATIO}px`,
          // How the line BREAKS, not just how wide it is. CSS breaks Korean between any two syllables and fills
          // greedily; libass breaks only at spaces and evens the lines out (WrapStyle 0). Without these two the
          // preview picks a different break than the render, which is the whole thing it exists to show.
          wordBreak: "keep-all",
          textWrap: "balance",
          // The weight the shipped file actually is — NotoSansKR-Medium — so the browser asks for the same
          // weight the burned-in subtitle is drawn at rather than synthesising one.
          fontWeight: 500,
          fontFamily: '"Noto Sans KR", system-ui, sans-serif',
          color: "#fff",
          textShadow: shadow,
        }}
      >
        {text}
      </div>
    );
  }

  return (
    <section aria-label="장면 자막 위치와 크기" className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
      <h2 className="text-base font-semibold text-slate-100">장면 자막</h2>

      <div className="flex flex-wrap items-start gap-5">
        <div className="shrink-0 space-y-2">
          <div
            data-testid="scene-subtitle-preview"
            className="relative overflow-hidden rounded-xl border border-white/10 bg-slate-950"
            style={{ width: `${width}px`, height: `${height}px` }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ width: `${frameWidth}px`, height: `${frameHeight}px`, transform: `scale(${previewScale})` }}
            >
              {shown && (
                <img
                  src={sceneImageContentUrl(projectId, shown.number)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              {shown && <div className="absolute inset-0">{block(shown.text, `shown-${shown.number}`)}</div>}
              {/* Every scene's line, laid out at the same geometry so the warning below can see all of them.
                  `visibility` rather than `display`: a box that is not laid out has no height to measure. */}
              <div ref={measureRef} aria-hidden="true" className="absolute inset-0" style={{ visibility: "hidden" }}>
                {scenes.map((scene) => block(scene.text, `measure-${scene.number}`))}
              </div>
            </div>
          </div>

          {/* Flipping through the scenes changes nothing and costs nothing — the layout is one setting for all
              of them. It is here because the place that clears the platform's interface on one shot can sit on
              the subject in the next, and that is only visible by looking. */}
          {scenes.length > 1 && (
            <div className="flex flex-wrap gap-1.5" data-testid="scene-subtitle-scene-picker">
              {scenes.map((scene, index) => (
                <button
                  key={scene.number}
                  type="button"
                  data-testid={`scene-subtitle-scene-${scene.number}`}
                  aria-pressed={index === shownIndex}
                  className={`rounded-full border px-2.5 py-1 text-xs tabular-nums ${
                    index === shownIndex
                      ? "border-violet-400/50 bg-violet-500/15 text-slate-100"
                      : "border-white/10 text-slate-400 hover:bg-white/5"
                  }`}
                  onClick={() => setShownIndex(index)}
                >
                  {scene.number}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-[16rem] flex-1 space-y-5">
          <div>
            <label className={label} htmlFor="scene-subtitle-scale">
              <span>글자 크기</span>
              <span className="tabular-nums text-slate-400" data-testid="scene-subtitle-scale-value">
                {Math.round(layout.scale * REFERENCE_HEIGHT)}px
              </span>
            </label>
            <input
              id="scene-subtitle-scale"
              data-testid="scene-subtitle-scale"
              type="range"
              className={field}
              min={SCENE_SUBTITLE_SCALE.min}
              max={SCENE_SUBTITLE_SCALE.max}
              step={0.001}
              value={layout.scale}
              disabled={disabled}
              onChange={(event) => onChange({ ...layout, scale: Number(event.target.value) })}
            />
          </div>

          <div>
            <label className={label} htmlFor="scene-subtitle-center">
              <span>세로 위치</span>
              <span className="tabular-nums text-slate-400" data-testid="scene-subtitle-center-value">
                위에서 {Math.round(layout.center * 100)}%
              </span>
            </label>
            <input
              id="scene-subtitle-center"
              data-testid="scene-subtitle-center"
              type="range"
              className={field}
              min={SCENE_SUBTITLE_CENTER.min}
              max={SCENE_SUBTITLE_CENTER.max}
              step={0.01}
              value={layout.center}
              disabled={disabled}
              onChange={(event) => onChange({ ...layout, center: Number(event.target.value) })}
            />
            {/* Both ends hurt, and in opposite ways. Said here rather than left to be found after a post. */}
            <p className="text-xs text-slate-500">
              아래로 내리면 릴스의 캡션·계정명·버튼에 가리고, 위로 올리면 장면 자체를 덮습니다.
            </p>
          </div>

          <button
            type="button"
            data-testid="scene-subtitle-reset"
            className="rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
            disabled={disabled || atDefault}
            onClick={() => onChange({ ...DEFAULT_SCENE_SUBTITLE_LAYOUT })}
          >
            기본값으로
          </button>
        </div>
      </div>

      {overflowing.length > 0 && (
        <p role="status" data-testid="scene-subtitle-overflow" className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
          {overflowing.join("번, ")}번 장면은 이 크기와 위치로는 글자가 화면 밖으로 나갑니다. 글자 크기를 줄이거나 위치를 옮겨 주세요.
        </p>
      )}
      {/* Said plainly rather than implied by how close it looks. Position and size are the point and those are
          real; the letterforms are the one thing a browser cannot promise. */}
      <p className="text-xs text-slate-500" data-testid="scene-subtitle-approximate">
        미리보기는 위치와 크기를 그대로 보여주지만, 글꼴 모양은 실제 영상과 조금 다를 수 있습니다. 값은 병합할 때 저장되고, 다시 병합해도 돈은 들지 않습니다.
      </p>
    </section>
  );
}
