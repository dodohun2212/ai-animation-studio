import { useState } from "react";
import type { VideoModel, VideoModelSetting } from "@ai-animation-studio/shared";
import { videoSceneEstimatedCostUsd } from "@ai-animation-studio/shared";

import { saveVideoModel, toDisplayError } from "../api/providerSettingsApi.js";

/**
 * Which model draws the video, and what that costs — asked for as "기능만 만들어놔".
 *
 * So this is the mechanism, not a placeholder for one. It renders the server's own option list; today that
 * list has one entry, and the day it has two this card is already a choice with no further work. What it must
 * never be is a dropdown that looks like a choice and changes nothing.
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
  const single = setting.options.length === 1;

  async function choose(model: VideoModel): Promise<void> {
    if (busy || model === setting.selected) return;
    setBusy(true); setError(null);
    try { onChange((await saveVideoModel(model)).videoModel); }
    catch (caught) { setError(toDisplayError(caught)); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="영상 모델" data-testid="video-model-card" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-100">영상 모델</h3>
        {/* Same distinction the monthly budget draws: nobody has chosen yet is not the same as chose this. */}
        {setting.isDefault && <span data-testid="video-model-default" className="text-xs text-slate-500">아직 고른 적이 없어 기본값을 쓰는 중입니다</span>}
      </div>
      <p className="text-sm text-slate-400">장면 이미지를 움직이는 영상으로 만드는 AI입니다. 바꾸면 <span className="text-slate-200">앞으로 만드는 영상</span>부터 적용되고, 이미 만들어 둔 클립은 그대로 남습니다.</p>

      <ul className="space-y-2">
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
                    1초당 ${option.pricePerSecondUsd.toFixed(2)} · 5초 장면 ${videoSceneEstimatedCostUsd(5, option).toFixed(2)} · 10초 장면 ${videoSceneEstimatedCostUsd(10, option).toFixed(2)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    비율 {option.ratios.join(" · ")} · 한 장면 최대 {option.maxDurationSeconds}초
                  </span>
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
