import { useState } from "react";
import type { VideoModel, VideoModelSetting } from "@ai-animation-studio/shared";

import { saveVideoModel, toDisplayError } from "../api/providerSettingsApi.js";
import {
  FRAME_SHAPE_NOTES,
  VIDEO_CLIP_AUDIO_NOTE,
  VIDEO_MODEL_FILTERS,
  VIDEO_MODEL_FILTER_LABELS,
  VIDEO_MODEL_SORTS,
  VIDEO_MODEL_SORT_LABELS,
  videoModelLastFrameLine,
  videoModelPriceLine,
  visibleVideoModels,
  type VideoModelFilter,
  type VideoModelSort,
} from "../utils/videoModelFacts.js";
import { scrollList } from "./ui/surfaces.js";

/* 🔴 Re-exported, not re-declared. The price line moved to `utils/videoModelFacts.ts` when the confirmation
   screen started saying the same thing, and this card is still where every existing pair imports it from —
   a second declaration here is exactly the duplicate-sentence bug that move was made to end. */
export { videoModelPriceLine };

/**
 * Which model draws the video, and what that costs — asked for as "기능만 만들어놔".
 *
 * So this is the mechanism, not a placeholder for one. It renders the server's own option list — which the
 * settings service hands over as `VIDEO_MODEL_OPTIONS` entire, so every model the adapter can reach is on this
 * screen by construction, not by anyone remembering to add it here. That list was one entry when this card was
 * written, three by the afternoon, and sixteen now; nothing in this file changed for any of it. What it must
 * never be is a dropdown that looks like a choice and changes nothing.
 *
 * 🔴 The spread is now the point. Sixteen models carry twelve distinct rates, $0.05/s to $0.68/s — a 5-second
 * scene costs $0.25 on the cheapest and $3.40 on the priciest, 13.6×. Every price on this card is computed from
 * the option being drawn for exactly that reason.
 *
 * 🔴 The price is shown per model, from the server's `pricePerSecondUsd`. A picker whose price does not move
 * with the model is worse than no picker: every estimate downstream — the confirmation panel, the retry
 * notice, the monthly preflight — would quote the old rate and let through a run the budget cannot afford.
 * The two clip lengths this app offers are both priced here, because that is the number a person is actually
 * choosing between.
 *
 * 🔴 The option object goes to `videoSceneEstimatedCostUsd`, never its id. Given a name it does not recognise
 * that function falls back to the default model and quotes *that* rate — so an id-based call priced a second
 * option at the first one's $0.05 and looked, on screen, like a price that had moved. This card is where that
 * would first be seen and last be noticed, so it prices from the option it is drawing.
 */

export function VideoModelCard({ setting, onChange }: { setting: VideoModelSetting; onChange: (next: VideoModelSetting) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  /* 기본값은 「기본 순서 · 전부」 — 그 상태의 화면은 이 줄들이 생기기 전과 같습니다. 거르기가 기본으로 켜져
     있으면 사람은 자기가 못 보는 모델이 있다는 것조차 모릅니다. */
  const [sort, setSort] = useState<VideoModelSort>("catalogue");
  const [filter, setFilter] = useState<VideoModelFilter>("all");
  const single = setting.options.length === 1;
  const shown = visibleVideoModels(setting.options, setting.selected, filter, sort);

  async function choose(model: VideoModel): Promise<void> {
    if (busy || model === setting.selected) return;
    setBusy(true); setError(null);
    try { onChange((await saveVideoModel(model)).videoModel); }
    catch (caught) { setError(toDisplayError(caught)); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="영상 모델" data-testid="video-model-card" className="space-y-3 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
          <span aria-hidden="true" className="h-3 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
          영상 모델
        </h3>
        {/* Same distinction the monthly budget draws: nobody has chosen yet is not the same as chose this. */}
        {setting.isDefault && <span data-testid="video-model-default" className="text-xs text-slate-500">아직 고른 적이 없어 기본값을 쓰는 중입니다</span>}
      </div>
      <p className="text-sm text-slate-400">장면 이미지를 움직이는 영상으로 만드는 AI입니다. 바꾸면 <span className="text-slate-300">앞으로 만드는 영상</span>부터 적용되고, 이미 만들어 둔 클립은 그대로 남습니다.</p>

      {/* 🔴 Bounded before it needs to be, because the thing that decides its length is the catalogue, not the
          person reading it. 캡틴D asked for every usable model on the adapter — Runway's own list has a dozen
          candidates — and an unbounded column of radio cards is exactly the shape that pushed the search box and
          everything under it off the screen in ①-1. `scrollList` is that fix's one home (docs/05_DESIGN_SYSTEM
          §3.8); with three options it changed nothing visible, and it keeps changing nothing as the list grows.

          🔴 And the token alone — no `space-y-2` beside it. `scrollList` already carries `space-y-1`, so adding a
          second spacing utility here put two of them on one element and left the winner to the order Tailwind
          happened to emit. That is a rule living in the cascade instead of in code, which is the thing this
          token exists to stop. If these rows ever need more air than the shared list gives, that belongs in
          `surfaces.ts` as a variant every such list gets, not as one call site quietly disagreeing. */}
      {/* 🔴 스무 줄입니다. 이 카드가 쓰였을 때는 한 줄이었고, 그때는 목록이 목록일 필요가 없었습니다. 지금은
          지금 쓰는 모델이 뭔지 보려고도 스크롤해야 하고, 「이어지는 릴에 쓸 수 있는 게 뭔가」는 스무 줄을
          직접 읽어야 답이 나옵니다 — 2026-09-13 에 캡틴D 가 한 일이 그것이고, 그래서 띠가 붙었습니다.
          거르기는 목록을 줄이는 기능이 아니라 **고르는 이유를 이름으로 부르는** 기능입니다. */}
      {!single && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="video-model-controls">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">순서</span>
            {VIDEO_MODEL_SORTS.map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`video-model-sort-${value}`}
                aria-pressed={sort === value}
                onClick={() => setSort(value)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${sort === value ? "border-violet-400/40 bg-violet-500/[0.12] text-slate-100" : "border-white/10 text-slate-400"}`}
              >
                {VIDEO_MODEL_SORT_LABELS[value]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">거르기</span>
            {VIDEO_MODEL_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`video-model-filter-${value}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === value ? "border-violet-400/40 bg-violet-500/[0.12] text-slate-100" : "border-white/10 text-slate-400"}`}
              >
                {VIDEO_MODEL_FILTER_LABELS[value]}
              </button>
            ))}
          </div>
          {/* 몇 개가 빠졌는지 말하지 않으면, 걸러진 목록은 그냥 「모델이 아홉 개인 앱」으로 읽힙니다. */}
          <span data-testid="video-model-count" className="text-xs tabular-nums text-slate-500">
            {setting.options.length}개 중 {shown.length}개
          </span>
        </div>
      )}
      <ul className={scrollList}>
        {shown.map((option) => {
          const chosen = option.id === setting.selected;
          return (
            <li key={option.id}>
              <label
                data-testid={`video-model-option-${option.id}`}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 ${chosen ? "border-violet-400/40 bg-violet-500/[0.07]" : "border-white/10 bg-slate-950/40"}`}
              >
                <input
                  type="radio"
                  name="video-model"
                  className="mt-1"
                  value={option.id}
                  checked={chosen}
                  disabled={busy}
                  onChange={() => void choose(option.id)}
                />
                <span className="flex-1 space-y-1">
                  <span className="block text-sm font-semibold text-slate-100">{option.label}</span>
                  <span className="block text-xs tabular-nums text-slate-300">
                    {videoModelPriceLine(option)}
                  </span>
                  {/* 🔴 조건을 붙인 문장입니다. 이 칸이 생겼을 때 앱은 끝 프레임을 **한 장도 안 보내고**
                      있었습니다 — 모델의 능력만 적어 두고 앱이 그걸 쓰는지는 아무도 안 적어서, 읽는 사람이
                      「이 모델을 고르면 이어진다」로 받아들였습니다. 캡틴D 께 H3 Max 를 권한 근거도 이 줄이었고,
                      그때 그 말은 참이 아니었습니다(Cowork 788 → CLI 789 에서 실제로 보내게 됨).
                      지금은 **「장면 이어 그리기」가 켜진 프로젝트에서만** 참이라, 그 조건을 문장에 넣습니다 —
                      보통 이야기의 장면은 일부러 끊는 컷이라 끝 프레임을 안 보냅니다.

                      The one line here that is not a number, and the reason the picker exists at all. A person
                      choosing between two models is choosing between two reels; price tells them what it costs
                      and this tells them what they get. Worded as what happens in the reel, never as the field
                      name — 「끝 프레임」 means nothing to someone who has not read the adapter. */}
                  <span className={`block text-xs ${option.acceptsLastFrame ? "text-slate-400" : "text-amber-300/90"}`}>
                    {videoModelLastFrameLine(option)}
                  </span>
                  {/* 🔴 An empty `ratios` is a real answer, not missing data — and it renders before any model
                      needs it, on purpose. Runway's own SDK types give some models on this endpoint no ratio
                      field at all (h3_max takes a `resolution` instead), and the contract's list would then be
                      empty. Joined blindly that printed 「비율  · 한 장면 최대 10초」, which reads as a bug in the
                      product rather than a property of the model. What such a model actually does with the
                      frame is NOT confirmed, so this says nothing about it: the line simply drops the half it
                      cannot state, and keeps the half it can. */}
                  <span className="block text-xs text-slate-500">
                    {option.ratios.length > 0 && <>비율 {option.ratios.join(" · ")} · </>}한 장면 최대 {option.maxDurationSeconds}초
                  </span>
                  {FRAME_SHAPE_NOTES[option.frameShape] !== null && (
                    <span data-testid={`video-model-frame-${option.id}`} className="block text-xs text-amber-300/90">
                      {FRAME_SHAPE_NOTES[option.frameShape]}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Said plainly rather than dressed up as a choice. A single radio that cannot be unchosen would leave a
          person clicking it to find out whether anything happens. */}
      {single && (
        <p data-testid="video-model-single" className="text-xs text-slate-500">
          지금 쓸 수 있는 모델은 이 하나입니다. 새 모델이 추가되면 여기에 함께 나오고, 그때 고르시면 됩니다.
        </p>
      )}

      {error && (
        <div className="space-y-2">
          <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>
          {/* The choice on screen is still the server's last answer — a failed save changed nothing, and the
              radio above is back on whatever is actually in use. */}
          <p className="text-xs text-slate-500">모델은 바뀌지 않았습니다. 지금 쓰는 모델은 위에 선택된 것 그대로입니다.</p>
        </div>
      )}
      {busy && <p className="text-xs text-slate-500">바꾸는 중...</p>}
      {/* 모델마다가 아니라 한 번. 어느 모델을 고르든 같은 답이고, 스무 줄에 같은 문장을 붙이면 위의 경고들이 묻힙니다. */}
      <p data-testid="video-model-audio" className="text-xs text-slate-500">{VIDEO_CLIP_AUDIO_NOTE}</p>
      <p className="text-xs text-slate-500">
        여기 금액은 이 앱이 예산을 계산할 때 쓰는 <span className="text-slate-300">예상치</span>입니다. 실제 청구액은 Runway 계정에서 확인해 주세요.
      </p>
    </section>
  );
}
