import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AspectRatio, PhotoCardSubtitleColors, PhotoCardSubtitleLayout } from "@ai-animation-studio/shared";
import {
  DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT,
  MERGE_FRAME_FOR_ASPECT,
  PHOTO_CARD_HEADING_RATIO,
  PHOTO_CARD_SUBTITLE_CENTER,
  PHOTO_CARD_SUBTITLE_CSS_RATIO,
  PHOTO_CARD_SUBTITLE_OUTLINE,
  PHOTO_CARD_SUBTITLE_SCALE,
  PHOTO_CARD_SUBTITLE_SHADOW,
  photoCardSubtitleGeometry,
  splitPhotoCardSubtitle,
} from "@ai-animation-studio/shared";

import { getPhotoCardSubtitleColors } from "../api/photoCardsApi.js";
import { sceneImageContentUrl } from "../api/videoWorkflowApi.js";

interface Props {
  projectId: string;
  /** The card's own line, exactly as it will be burned in — newlines included, since the first one splits the two styles. */
  quote: string;
  /** The project's shape — the preview is drawn at the merge's real frame for it (MERGE_FRAME_FOR_ASPECT), 1:1 and 4:5 included. */
  aspectRatio: AspectRatio;
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
 * How long the slider has to sit still before the colours are asked for again.
 *
 * Moving the band changes which part of the picture the colours are read off, so the answer really does go
 * stale as the slider moves — but every ask is a pass over the picture on the user's own machine (free, not
 * instant), and a drag fires dozens of steps. CLI Round 888 asked for roughly one ask after the drag ends;
 * this is that, and it is deliberately longer than a keypress so holding an arrow key does not queue a dozen.
 */
const COLOR_SETTLE_MS = 400;

/** What the merge burns when it cannot read the picture — the preview's floor, and its answer while it waits. */
const FALLBACK_COLORS: PhotoCardSubtitleColors = { body: "#ffffff", heading: "#ffffff", outline: "#000000" };

/** `#RRGGBB` → `rgba(r, g, b, a)`. The guard in photoCardsApi is what makes the slice safe. */
function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Size and height for a photo card's burned-in text, with the card itself behind it.
 *
 * Until this existed the only way to see the result was to merge, look, and merge again — and the first two
 * attempts went out with the text under Instagram's own interface, where it could not be read at all. The
 * numbers are the same ones the server accepts, read from the shared bounds rather than repeated, so a slider
 * cannot reach a value the merge would refuse.
 */
export function PhotoCardSubtitleFieldset({ projectId, quote, aspectRatio, layout, onChange, disabled }: Props) {
  /*
   * Drawn at the video's real size and scaled down, not laid out small.
   *
   * A small box wraps a long line at a different place than a 1080-wide frame does, and the number of lines is
   * what decides whether the block still fits: measured on the real frame, thirty body lines at the default
   * size run off both ends, and ten at the largest size run off the top (CLI Round 445). A preview that wrapped
   * differently would show those cases fitting. So the frame is 1080x1920 here too, and only the last step —
   * a CSS scale — makes it small enough to sit beside the sliders.
   */
  // The merge's own frame for this shape (1080x1920, 1920x1080, 1080x1080, 1080x1350), its long side scaled to
  // PREVIEW_LONG_SIDE. Was `vertical ? 1080x1920 : 1920x1080`, which drew a square or 4:5 project's text on a
  // 9:16 frame — wrapped and placed for a video nobody makes.
  const { width: frameWidth, height: frameHeight } = MERGE_FRAME_FOR_ASPECT[aspectRatio];
  const width = Math.round(PREVIEW_LONG_SIDE * frameWidth / Math.max(frameWidth, frameHeight));
  const height = Math.round(PREVIEW_LONG_SIDE * frameHeight / Math.max(frameWidth, frameHeight));
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
  /**
   * The colours the merge would actually burn, asked of the server rather than guessed at here.
   *
   * The merge picks them off the picture — bright text on a dark photo, dark on a bright one, the first line in
   * a stronger shade (CLI Round 886). The preview drew plain white regardless, so the one thing it existed to
   * prevent — merge, look, merge again — came back for colour. The lookup runs the **same sampling function**
   * the merge does (Round 888), which is what makes this a preview and not a second opinion.
   *
   * 🔴 A failed lookup drops back to white-on-black and says so, rather than keeping the last answer. Colours
   * belong to a band of the picture, so an answer for a band the slider has left is about somewhere else — and
   * a preview showing colours for the wrong place is worse than one admitting it does not know.
   */
  const [colors, setColors] = useState<PhotoCardSubtitleColors | null>(null);
  const [colorsUnavailable, setColorsUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void getPhotoCardSubtitleColors(projectId, layout.center)
        .then((response) => {
          if (cancelled) return;
          // `colors: null` is an answer, not a failure — the picture could not be read and the merge will burn
          // white on black, which is exactly what the fallback below draws. No note belongs on that case.
          setColors(response.colors);
          setColorsUnavailable(false);
        })
        .catch(() => {
          if (cancelled) return;
          setColors(null);
          setColorsUnavailable(true);
        });
    }, COLOR_SETTLE_MS);
    // 🔴 Cleared on every change, so a drag leaves one request at the end instead of one per step. `cancelled`
    // covers the other half: a reply that arrives after the band has moved must not paint the new position.
    return () => { cancelled = true; clearTimeout(timer); };
    // `scale` is deliberately absent — the band the colours are read off is decided by `center` alone, so
    // resizing the text must not cost a pass over the picture.
  }, [projectId, layout.center]);
  const drawn = colors ?? FALLBACK_COLORS;

  const stroke = PHOTO_CARD_SUBTITLE_OUTLINE;
  const drop = PHOTO_CARD_SUBTITLE_SHADOW;
  const edge = drawn.outline;
  // The shadow is the outline at half strength — the renderer's own relationship between the two, not a
  // separate black the preview invented (it used to be a flat rgba(0,0,0,0.85) under any outline colour).
  const shadow = `0 0 ${stroke}px ${edge}, ${drop}px ${drop}px ${stroke * 2}px ${withAlpha(edge, 0.5)}, -${stroke}px 0 ${stroke}px ${edge}, ${stroke}px 0 ${stroke}px ${edge}, 0 -${stroke}px ${stroke}px ${edge}, 0 ${stroke}px ${stroke}px ${edge}`;

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
          /*
           * How the line breaks, not just how wide it is — the other half of matching the video.
           *
           * The CSS_RATIO above made a line the same WIDTH as the render; these two make it break in the same
           * PLACES. libass differs from a browser's default in two ways at once, and both showed on 불요불굴:
           *
           *   keep-all   CSS breaks Korean between any two syllables, so the preview split 마라. into 마 / 라.
           *              libass breaks only at spaces. keep-all is that rule.
           *   balance    libass's WrapStyle 0 is "smart" wrapping — it evens the lines out. CSS fills greedily,
           *              so a two-line card previewed as one nearly-full line and a stub (916px / 118px against
           *              the render's 491 / 515).
           *
           * Measured, not reasoned: the five finished cards were rendered through the real FFmpeg with the real
           * font files and their line boxes read off the frames, then the same texts measured here. With both
           * properties the preview picks the render's break in all five, line widths within 3% (an ink bounding
           * box against an advance width). Without them it picks a different break in all five.
           *
           * 🟠 An approximation, not the same algorithm: `text-wrap: balance` is the browser's own balancer and
           * browsers stop balancing past a handful of lines. It agrees with libass on cards this size; a much
           * longer body could still disagree, and the overflow warning below stays the honest backstop.
           */
          wordBreak: "keep-all",
          textWrap: "balance",
          // Both faces are Bold now: 3a56577 flipped the card's Body style as well as the reel's Default,
          // because SCENE_SUBTITLE_CSS_RATIO is derived from PHOTO_CARD_SUBTITLE_CSS_RATIO.body — one number
          // cannot describe two layouts drawn from different files.
          fontWeight: 700,
          fontFamily: serif ? '"Noto Serif KR", "Nanum Myeongjo", serif' : '"Noto Sans KR", system-ui, sans-serif',
          // 첫 줄(사자성어)은 `heading`, 본문은 `body` — 병합이 ASS 에 넣는 그 두 색입니다.
          color: serif ? drawn.heading : drawn.body,
          textShadow: shadow,
        }}
      >
        {text}
      </div>
    );
  }

  return (
    <section aria-label="자막 위치와 크기" className="space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-6">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
        <span aria-hidden="true" className="h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
        자막
      </h2>

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
            className="rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
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
        <p role="status" data-testid="photo-card-subtitle-overflow" className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          이 길이와 크기로는 글자가 화면 밖으로 나갑니다. 글자 크기를 줄이거나, 명언을 짧게 하거나, 위치를 옮겨 주세요.
        </p>
      )}
      {colorsUnavailable && (
        /* The one case where this preview knowingly shows something the merge will not burn. Said out loud,
           because the alternative — white text sitting there looking settled — is the exact failure Round 886
           created and Round 888 opened the lookup to close. */
        <p role="status" data-testid="photo-card-subtitle-colors-unavailable" className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          글자 색을 불러오지 못해 흰 글씨로 보여드리고 있습니다. 실제 영상은 그림에 맞춘 색으로 만들어집니다 — 위치를 살짝 움직이면 다시 시도합니다.
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
