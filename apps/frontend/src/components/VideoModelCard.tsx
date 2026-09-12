import { useState } from "react";
import type { VideoFrameShape, VideoModel, VideoModelOption, VideoModelSetting } from "@ai-animation-studio/shared";
import { videoSceneEstimatedCostUsd } from "@ai-animation-studio/shared";

import { saveVideoModel, toDisplayError } from "../api/providerSettingsApi.js";
import { scrollList } from "./ui/surfaces.js";

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

/**
 * The whole price of one scene, in one line, with nothing left for the reader to work out.
 *
 * 🔴 Exported so the pair can assert the row contains exactly this. The format lives in one place; a test
 * that rebuilt the sentence itself would agree with a card that had stopped saying it.
 *
 * 🔴 The two optional halves are the reason this is no longer a template literal inline. `pricePerSecondUsd`
 * alone stopped being the price: Gemini and Grok add a flat charge per scene, and Mini and 2.5 never bill below
 * a floor. Both were already in every quote the moment the contract carried them — `videoSceneEstimatedCostUsd`
 * folds them in — so the numbers on this card were right and the *explanation* was missing. That gap is its own
 * failure: 「1초당 $0.10」 beside 「5초 장면 $0.51」 is a card a person checks with a calculator, disagrees with,
 * and stops trusting. `contract-optional-fields.test.ts` was holding both fields as a named gap for exactly this
 * line; reading them here is what closes it.
 */
export function videoModelPriceLine(option: VideoModelOption): string {
  const perSecond = `1초당 $${option.pricePerSecondUsd.toFixed(2)}`;
  // Immediately after the rate, because it is what makes the rate alone wrong.
  const perScene = option.perGenerationUsd === undefined ? "" : ` + 장면당 $${option.perGenerationUsd.toFixed(2)}`;
  const scenes = ` · 5초 장면 $${videoSceneEstimatedCostUsd(5, option).toFixed(2)} · 10초 장면 $${videoSceneEstimatedCostUsd(10, option).toFixed(2)}`;
  /* Worded as what it does, not as its name. Both clip lengths this app offers already clear every floor in the
     catalogue, so this number never appears in the two totals beside it — which is precisely why it has to be
     said out loud rather than inferred from them. */
  const minimum = option.minimumChargeUsd === undefined ? "" : ` · 짧아도 최소 $${option.minimumChargeUsd.toFixed(2)}`;
  return `${perSecond}${perScene}${scenes}${minimum}`;
}

/**
 * Whose shape the finished clip keeps — and, for two of the three answers, what that does to the reel.
 *
 * 🔴 A `Record` over the contract's own union, so a fourth shape is a compile error here rather than a row that
 * quietly says nothing. `null` is a real answer and not a hole: for `requested` there is nothing to warn about,
 * and twelve of twenty rows carrying a reassuring sentence would bury the four that matter.
 *
 * 🔴 `unconfirmed` gets its own sentence rather than silence, and that is the whole point of asking for a
 * three-valued field. Silence there reads as 「괜찮다」 to anyone comparing rows, which is the reassuring
 * direction — the wrong one to be wrong in. It also happens to be the model 캐프틴D's first reel is planned on
 * (H3 Max 480p), so the one row where 「확인 안 됨」 must be said is the one row somebody is about to press.
 */
const FRAME_SHAPE_NOTES: Record<VideoFrameShape, string | null> = {
  requested: null,
  follows_first_frame:
    "이 모델은 장면 그림의 비율을 그대로 따릅니다 — 그림이 릴 비율과 다르면 완성본 위아래에 띠가 생길 수 있습니다.",
  unconfirmed:
    "이 모델이 어떤 비율로 내보내는지는 확인되지 않았습니다 — 완성본 위아래에 띠가 생길 수 있습니다.",
};

export function VideoModelCard({ setting, onChange }: { setting: VideoModelSetting; onChange: (next: VideoModelSetting) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const single = setting.options.length === 1;

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
      <ul className={scrollList}>
        {setting.options.map((option) => {
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
                    {option.acceptsLastFrame
                      ? "「장면 이어 그리기」를 켠 프로젝트에서는, 앞 클립이 끝난 그 그림에서 다음 클립이 시작합니다 — 이어지는 릴에 좋습니다."
                      : "앞 클립이 끝난 장면을 이어받지 못합니다 — 성장·이동처럼 계속 이어지는 릴에서는 컷이 뒤로 돌아갈 수 있습니다."}
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
      <p className="text-xs text-slate-500">
        여기 금액은 이 앱이 예산을 계산할 때 쓰는 <span className="text-slate-300">예상치</span>입니다. 실제 청구액은 Runway 계정에서 확인해 주세요.
      </p>
    </section>
  );
}
