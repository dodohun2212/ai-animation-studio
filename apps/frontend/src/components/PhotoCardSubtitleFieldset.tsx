import type { PhotoCardSubtitleLayout } from "@ai-animation-studio/shared";
import { DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, PHOTO_CARD_SUBTITLE_CENTER, PHOTO_CARD_SUBTITLE_SCALE } from "@ai-animation-studio/shared";

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

/** The frame the renderer works in. Only used to say the chosen size in pixels, which is the unit a person can picture. */
const REFERENCE_HEIGHT = 1920;
/** The preview's own height in CSS pixels; every size below is a fraction of it, exactly as the renderer works from frame height. */
const PREVIEW_HEIGHT = 420;

/**
 * The renderer's geometry, repeated here and nowhere else.
 *
 * These five lines are `subtitle-file.ts`'s, in the same order and with the same rounding rule (CLI Round 439
 * published them for this): body from the frame height, the quote line derived at 1.4x rather than being its
 * own control, and the block centred on `center` instead of sitting on a bottom margin. Repeating them is what
 * makes this a preview rather than a decoration — but it is a *repeat*, so a change to the renderer's numbers
 * has to come back here, and the fact that it is an approximation is said on screen rather than implied.
 */
function geometry(height: number, layout: PhotoCardSubtitleLayout, quote: string) {
  const body = Math.round(height * layout.scale);
  const head = Math.round(body * 1.4);
  const headGap = Math.round(head * 1.6);
  const lineGap = Math.round(body * 1.5);
  const parts = quote.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  // No newline means no 사자성어 line — the whole thing is body text. Assuming two parts would set a one-line
  // card entirely in the quote face, which is the renderer's own rule and has to be the preview's too.
  const headLine = parts.length > 1 ? parts[0]! : null;
  const bodyLines = parts.length > 1 ? parts.slice(1) : parts;
  const total = (headLine ? headGap : 0) + lineGap * Math.max(0, bodyLines.length - 1);
  const top = height * layout.center - total / 2;
  return { body, head, headGap, lineGap, headLine, bodyLines, top };
}

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
  const height = PREVIEW_HEIGHT;
  const width = Math.round(height * (vertical ? 9 / 16 : 16 / 9));
  const { body, head, headLine, bodyLines, headGap, lineGap, top } = geometry(height, layout, quote);
  const sidePadding = Math.round(width * 0.07);
  const atDefault = layout.scale === DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT.scale && layout.center === DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT.center;
  // Scaled from the renderer's Outline 4 / Shadow 2 at 1920. A stroke that stays 4px wide in a 420px preview
  // would be a thick black border around every letter and would read as a different design.
  const stroke = Math.max(1, Math.round((4 * height) / REFERENCE_HEIGHT));
  const shadow = `0 0 ${stroke}px #000, ${stroke}px ${stroke}px ${stroke * 2}px rgba(0,0,0,0.85), -${stroke}px 0 ${stroke}px #000, ${stroke}px 0 ${stroke}px #000, 0 -${stroke}px ${stroke}px #000, 0 ${stroke}px ${stroke}px #000`;

  function line(text: string, y: number, size: number, serif: boolean, key: string) {
    return (
      <div
        key={key}
        className="absolute left-0 right-0 text-center leading-tight"
        style={{
          top: `${y}px`,
          transform: "translateY(-50%)",
          paddingLeft: `${sidePadding}px`,
          paddingRight: `${sidePadding}px`,
          fontSize: `${size}px`,
          fontWeight: serif ? 700 : 400,
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
          <img
            src={sceneImageContentUrl(projectId, 1)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          {headLine && line(headLine, top, head, true, "head")}
          {bodyLines.map((text, index) =>
            line(text, top + (headLine ? headGap : 0) + index * lineGap, body, false, `body-${index}`))}
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
            <p className="text-xs text-slate-500">사자성어 줄은 이 크기의 1.4배로 따라 커집니다.</p>
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

      {/* Said plainly rather than implied by how close it looks: the browser is not the renderer, and the one
          thing this cannot promise is the exact letterforms. Position and size are the point and those are real. */}
      <p className="text-xs text-slate-500" data-testid="photo-card-subtitle-approximate">
        미리보기는 위치와 크기를 그대로 보여주지만, 글꼴 모양은 실제 영상과 조금 다를 수 있습니다. 값은 병합할 때 저장되어 다음에도 그대로 시작합니다.
      </p>
    </section>
  );
}
