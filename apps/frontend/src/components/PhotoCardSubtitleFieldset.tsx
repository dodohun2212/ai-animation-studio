import { useLayoutEffect, useRef, useState } from "react";
import type { PhotoCardSubtitleLayout } from "@ai-animation-studio/shared";
import {
  DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT,
  PHOTO_CARD_HEADING_RATIO,
  PHOTO_CARD_SUBTITLE_CENTER,
  PHOTO_CARD_SUBTITLE_CSS_RATIO,
  PHOTO_CARD_SUBTITLE_OUTLINE,
  PHOTO_CARD_SUBTITLE_SCALE,
  PHOTO_CARD_SUBTITLE_SHADOW,
  photoCardSubtitleGeometry,
  splitPhotoCardSubtitle,
} from "@ai-animation-studio/shared";

import { sceneImageContentUrl } from "../api/videoWorkflowApi.js";

interface Props {
  projectId: string;
  /** The card's own line, exactly as it will be burned in — newlines included, since the first one splits the two styles. */
  quote: string;
  vertical: boolean;
  layout: PhotoCardSubtitleLayout;
  onChange: (layout: PhotoCardSubtitleLayout) => void;
  disabled?: boolean;
}

/** The long side of the frame the renderer works in. Sizes are said in these pixels, which is the unit a person can picture. */
const REFERENCE_HEIGHT = 1920;
/** The preview's longest side on screen. The frame is drawn at full size and scaled down to this — see the box below for why. */
const PREVIEW_LONG_SIDE = 420;

const field = "w-full accent-violet-400 disabled:opacity-50";
const label = "flex items-baseline justify-between text-sm text-slate-300";

/**
 * Size and height for a photo card's burned-in text, with the card itself behind it.
 *
 * Until this existed the only way to see the result was to merge, look, and merge again — and the first two
 * attempts went out with the text under Instagram's own interface, where it could not be read at all. The
 * numbers are the same ones the server accepts, read from the shared bounds rather than repeated, so a slider
 * cannot reach a value the merge would refuse.
 */
export function PhotoCardSubtitleFieldset({ projectId, quote, vertical, layout, onChange, disabled }: Props) {
  /*
   * Drawn at the video's real size and scaled down, not laid out small.
   *
   * A small box wraps a long line at a different place than a 1080-wide frame does, and the number of lines is
   * what decides whether the block still fits: measured on the real frame, thirty body lines at the default
   * size run off both ends, and ten at the largest size run off the top (CLI Round 445). A preview that wrapped
   * differently would show those cases fitting. So the frame is 1080x1920 here too, and only the last step —
   * a CSS scale — makes it small enough to sit beside the sliders.
   */
  const frameWidth = vertical ? 1080 : 1920;
  const frameHeight = vertical ? 1920 : 1080;
  const width = vertical ? Math.round(PREVIEW_LONG_SIDE * 9 / 16) : PREVIEW_LONG_SIDE;
  const height = vertical ? PREVIEW_LONG_SIDE : Math.round(PREVIEW_LONG_SIDE * 9 / 16);
  const scale = width / frameWidth;
  // The renderer's own arithmetic, called rather than repeated. It used to be five lines copied out of
  // `subtitle-file.ts`, which is a preview that can be silently wrong — showing a picture of a video nobody
  // made. CLI Round 441 moved the numbers into `shared` so both ends read one function; only the frame differs
  // (this box's pixels instead of 1080x1920), which is exactly what makes it a preview rather than a copy.
  const { heading, body: bodyLines } = splitPhotoCardSubtitle(quote);
  const g = photoCardSubtitleGeometry(frameWidth, frameHeight, layout, bodyLines.length, heading !== undefined);
  // `bodyY` is the block's centre; the lines are laid out from it so the block stays centred as lines are added.
  const firstBodyY = g.bodyY - (g.lineGap * Math.max(0, bodyLines.length - 1)) / 2;
  const atDefault = layout.scale === DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT.scale && layout.center === DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT.center;
  /*
   * The edge, approximated rather than reproduced.
   *
   * libass strokes a glyph outline; CSS can only stack shadows, so these two cannot draw the same thing and
   * pretending otherwise would be worse than saying so (the note under the preview does). The widths are the
   * renderer's own constants used unchanged — the whole frame is drawn at full size and scaled at the end, so
   * they shrink with everything else instead of needing their own arithmetic.
   */
  const stroke = PHOTO_CARD_SUBTITLE_OUTLINE;
  const drop = PHOTO_CARD_SUBTITLE_SHADOW;
  const shadow = `0 0 ${stroke}px #000, ${drop}px ${drop}px ${stroke * 2}px rgba(0,0,0,0.85), -${stroke}px 0 ${stroke}px #000, ${stroke}px 0 ${stroke}px #000, 0 -${stroke}px ${stroke}px #000, 0 ${stroke}px ${stroke}px #000`;

  const margin = g.margin;

  /**
   * Whether any line falls outside the frame, read off the drawn preview instead of predicted.
   *
   * Predicting it would mean knowing where the text wrapped, which is the browser's answer and not something a
   * formula here has. Since the frame is now drawn at its real size, asking the DOM is both simpler and the
   * more honest of the two.
   */
  const blockRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const block = blockRef.current;
    if (!block) return;
    let cancelled = false;
    const measure = (): void => {
      if (cancelled) return;
      const lines = Array.from(block.children) as unknown as { offsetTop: number; offsetHeight: number; scrollWidth: number; clientWidth: number }[];
      setOverflowing(lines.some((node) =>
        // Each line is centred on its own top coordinate (translateY(-50%)), so its extent is half a line either way.
        node.offsetTop - node.offsetHeight / 2 < 0
        || node.offsetTop + node.offsetHeight / 2 > frameHeight
        // Sideways too, and this is not hypothetical: at the largest size the 사자성어 line is wider than the frame
        // and runs off both edges without ever being taller than it. Seen at 96px on 불광불급(不狂不及).
        || node.scrollWidth > node.clientWidth));
    };
    measure();
    /*
     * Measured again once the real faces have arrived.
     *
     * The two subtitle fonts are now loaded from the backend (styles.css), and a webfont lands after the first
     * paint — so this first measurement is of whatever fallback the machine had, and the warning it produces
     * would be about a font the video will not use. The overflow it reports is a real one: at 96px the
     * 사자성어 line runs off both edges, and a warning computed in the wrong face is a warning about the wrong
     * width.
     *
     * `document.fonts` is absent under jsdom, so this is a no-op in tests rather than a failure. Nothing here
     * waits on it: the first measurement still happens immediately.
     */
    void document.fonts?.ready.then(measure).catch(() => { /* A face that never loads leaves the first measurement standing, which is the honest floor. */ });
    return () => { cancelled = true; };
  }, [quote, layout.scale, layout.center, frameHeight, frameWidth]);

  function line(text: string, y: number, size: number, serif: boolean, key: string) {
    return (
      <div
        key={key}
        className="absolute left-0 right-0 text-center leading-tight"
        style={{
          top: `${y}px`,
          transform: "translateY(-50%)",
          paddingLeft: `${margin}px`,
          paddingRight: `${margin}px`,
          // The ASS size scaled to what CSS has to be set to for the same drawn width. libass sizes a font by
          // its own vertical metrics, so `font-size: 52px` is about half again as wide as `Fontsize 52` —
          // which made this preview wrap early and warn about overflow the video never had. The two ratios
          // are measured off real rendered frames and differ between the faces, so they stay separate.
          fontSize: `${size * (serif ? PHOTO_CARD_SUBTITLE_CSS_RATIO.heading : PHOTO_CARD_SUBTITLE_CSS_RATIO.body)}px`,
          // The weights the two files actually are — Serif Bold, Sans Medium — so the browser picks each face
          // exactly rather than by nearest match, and so the preview asks for the same weight the burned-in
          // subtitle is drawn at. See the @font-face pair in styles.css.
          fontWeight: serif ? 700 : 500,
          fontFamily: serif ? '"Noto Serif KR", "Nanum Myeongjo", serif' : '"Noto Sans KR", system-ui, sans-serif',
          color: "#fff",
          textShadow: shadow,
        }}
      >
        {text}
      </div>
    );
  }

  return (
    <section aria-label="자막 위치와 크기" className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
      <h2 className="text-base font-semibold text-slate-100">자막</h2>

      <div className="flex flex-wrap items-start gap-5">
        <div
          data-testid="photo-card-subtitle-preview"
          className="relative shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950"
          style={{ width: `${width}px`, height: `${height}px` }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: `${frameWidth}px`, height: `${frameHeight}px`, transform: `scale(${scale})` }}
          >
            <img
              src={sceneImageContentUrl(projectId, 1)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* The lines alone, so measuring what runs off the frame does not have to step over the picture. */}
            <div ref={blockRef} className="absolute inset-0">
              {heading !== undefined && line(heading, g.headingY, g.headSize, true, "head")}
              {bodyLines.map((text, index) =>
                line(text, firstBodyY + index * g.lineGap, g.bodySize, false, `body-${index}`))}
            </div>
          </div>
        </div>

        <div className="min-w-[16rem] flex-1 space-y-5">
          <div>
            <label className={label} htmlFor="photo-card-subtitle-scale">
              <span>글자 크기</span>
              <span className="tabular-nums text-slate-400" data-testid="photo-card-subtitle-scale-value">
                {Math.round(layout.scale * REFERENCE_HEIGHT)}px
              </span>
            </label>
            <input
              id="photo-card-subtitle-scale"
              data-testid="photo-card-subtitle-scale"
              type="range"
              className={field}
              min={PHOTO_CARD_SUBTITLE_SCALE.min}
              max={PHOTO_CARD_SUBTITLE_SCALE.max}
              step={0.001}
              value={layout.scale}
              disabled={disabled}
              onChange={(event) => onChange({ ...layout, scale: Number(event.target.value) })}
            />
            <p className="text-xs text-slate-500">사자성어 줄은 이 크기의 {PHOTO_CARD_HEADING_RATIO}배로 따라 커집니다.</p>
          </div>

          <div>
            <label className={label} htmlFor="photo-card-subtitle-center">
              <span>세로 위치</span>
              <span className="tabular-nums text-slate-400" data-testid="photo-card-subtitle-center-value">
                위에서 {Math.round(layout.center * 100)}%
              </span>
            </label>
            <input
              id="photo-card-subtitle-center"
              data-testid="photo-card-subtitle-center"
              type="range"
              className={field}
              min={PHOTO_CARD_SUBTITLE_CENTER.min}
              max={PHOTO_CARD_SUBTITLE_CENTER.max}
              step={0.01}
              value={layout.center}
              disabled={disabled}
              onChange={(event) => onChange({ ...layout, center: Number(event.target.value) })}
            />
            {/* Where the two ends actually hurt, said once instead of left to be discovered after a post. */}
            <p className="text-xs text-slate-500">
              너무 아래로 내리면 릴스의 캡션·계정명·버튼에 가립니다.
            </p>
          </div>

          <button
            type="button"
            data-testid="photo-card-subtitle-reset"
            className="rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
            disabled={disabled || atDefault}
            onClick={() => onChange({ ...DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT })}
          >
            기본값으로
          </button>
        </div>
      </div>

      {overflowing && (
        /* Measured on the drawn frame rather than predicted, so it counts the lines the text actually wrapped
           into. A long quote at a large size runs off the top and bottom, and until the frame was drawn at full
           size this was the one failure the preview could not show. */
        <p role="status" data-testid="photo-card-subtitle-overflow" className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
          이 길이와 크기로는 글자가 화면 밖으로 나갑니다. 글자 크기를 줄이거나, 명언을 짧게 하거나, 위치를 옮겨 주세요.
        </p>
      )}
      {/* Said plainly rather than implied by how close it looks: the browser is not the renderer, and the one
          thing this cannot promise is the exact letterforms. Position and size are the point and those are real. */}
      <p className="text-xs text-slate-500" data-testid="photo-card-subtitle-approximate">
        미리보기는 위치와 크기를 그대로 보여주지만, 글꼴 모양은 실제 영상과 조금 다를 수 있습니다. 값은 병합할 때 저장되어 다음에도 그대로 시작합니다.
      </p>
    </section>
  );
}
