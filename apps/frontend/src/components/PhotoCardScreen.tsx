import { useEffect, useState, type FormEvent } from "react";
import type { Asset, RunwayClipDurationSeconds } from "@ai-animation-studio/shared";
import { PHOTO_CARD_QUOTE_MAX_LENGTH, RUNWAY_CLIP_DURATIONS } from "@ai-animation-studio/shared";

import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { createPhotoCard, toPhotoCardDisplayError } from "../api/photoCardsApi.js";
import { Spinner } from "./Spinner.js";

interface Props {
  onBack: () => void;
  /** Where to go once the card exists: its merge screen, which is where music and the credit line live. */
  onCreated: (projectId: string) => void;
}

type DisplayError = { code: string; message: string };



const field =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6";
const outlineButton =
  "rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50";

/**
 * A quote over a picture, made from a picture the app already has.
 *
 * The whole flow existed before this screen — the merge burns the text as a subtitle, the audio library holds
 * the music, the publish screen posts the result. What was missing was the front door: making one meant
 * creating a project, writing a script, approving mappings, generating images and videos, and only then typing
 * the line. This screen is that front door and nothing more; it hands the finished card to the merge screen,
 * which is where music and its credit line already live and where they will keep living.
 */
export function PhotoCardScreen({ onBack, onCreated }: Props) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [listError, setListError] = useState<DisplayError | null>(null);
  const [assetId, setAssetId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [quote, setQuote] = useState("");
  const [seconds, setSeconds] = useState<RunwayClipDurationSeconds>(RUNWAY_CLIP_DURATIONS[0]);
  const [vertical, setVertical] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAssets()
      .then((response) => { if (!cancelled) setAssets(response.assets.filter((asset) => !asset.isFolder && asset.imageAvailable)); })
      .catch((caught: unknown) => { if (!cancelled) setListError(toAssetDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  const trimmedQuote = quote.trim();
  const trimmedId = projectId.trim();
  const ready = Boolean(assetId) && trimmedQuote.length > 0 && trimmedId.length > 0 && trimmedQuote.length <= PHOTO_CARD_QUOTE_MAX_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await createPhotoCard({
        projectId: trimmedId,
        assetId,
        quote: trimmedQuote,
        clipDurationSeconds: seconds,
        aspectRatio: vertical ? "9:16" : "16:9",
      });
      onCreated(response.project.id);
    } catch (caught) {
      setError(toPhotoCardDisplayError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-5">
      <button type="button" className="text-sm text-slate-400 hover:text-slate-200" onClick={onBack}>
        ← 프로젝트 목록으로
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />
        명언 카드
      </h1>
      <p className="text-sm text-slate-400">
        보관함의 그림 한 장에 문장을 얹어 짧은 영상으로 만듭니다. 그림은 이미 만들어 둔 것을 그대로 쓰기 때문에{" "}
        <span className="font-semibold text-slate-200">여기서는 돈이 나가지 않습니다.</span>
      </p>

      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <section aria-label="그림 고르기" className={cardSection}>
          <h2 className="text-base font-semibold text-slate-100">그림 고르기</h2>
          {!assets && !listError && <Spinner label="보관함을 불러오는 중..." />}
          {listError && (
            <p role="alert" data-testid="photo-card-list-error" data-error-code={listError.code} className="text-sm text-rose-400">
              {listError.message}
            </p>
          )}
          {assets && assets.length === 0 && (
            <p data-testid="photo-card-empty" className="text-sm text-slate-400">
              보관함에 쓸 수 있는 그림이 없습니다. 이미지 보관함에서 먼저 등록해 주세요.
            </p>
          )}
          {assets && assets.length > 0 && (
            <ul aria-label="그림 목록" className="grid max-h-[420px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
              {assets.map((asset) => {
                const picked = asset.assetId === assetId;
                return (
                  <li key={asset.assetId}>
                    <button
                      type="button"
                      data-testid={`photo-card-asset-${asset.assetId}`}
                      aria-pressed={picked}
                      disabled={pending}
                      className={`w-full space-y-1 rounded-xl border p-1.5 text-left disabled:opacity-50 ${picked ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 hover:bg-white/5"}`}
                      onClick={() => setAssetId(asset.assetId)}
                    >
                      {asset.contentUrl && (
                        <img src={asset.contentUrl} alt={asset.displayName} className="w-full rounded-lg border border-white/10 object-cover" />
                      )}
                      <span className="block truncate text-xs text-slate-300">{asset.displayName}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="문장과 길이" className={cardSection}>
          <label className="block text-sm text-slate-300">
            명언
            <textarea
              data-testid="photo-card-quote"
              className={field}
              rows={3}
              value={quote}
              disabled={pending}
              placeholder="화면 아래에 그대로 나옵니다"
              onChange={(event) => setQuote(event.target.value)}
            />
          </label>
          {/* The limit is the server's, said before the button rather than after it — a refusal that arrives
              only on submit makes the person retype what they already wrote. */}
          <p className={`text-xs tabular-nums ${trimmedQuote.length > PHOTO_CARD_QUOTE_MAX_LENGTH ? "text-rose-400" : "text-slate-500"}`} data-testid="photo-card-quote-count">
            {trimmedQuote.length} / {PHOTO_CARD_QUOTE_MAX_LENGTH}자
          </p>

          <label className="block text-sm text-slate-300">
            길이
            <select
              data-testid="photo-card-seconds"
              className={field}
              value={seconds}
              disabled={pending}
              onChange={(event) => setSeconds(Number(event.target.value) as RunwayClipDurationSeconds)}
            >
              {RUNWAY_CLIP_DURATIONS.map((value) => <option key={value} value={value}>{value}초</option>)}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            화면 비율
            <select
              data-testid="photo-card-aspect"
              className={field}
              value={vertical ? "9:16" : "16:9"}
              disabled={pending}
              onChange={(event) => setVertical(event.target.value === "9:16")}
            >
              <option value="9:16">세로 (9:16)</option>
              <option value="16:9">가로 (16:9)</option>
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            이름
            <input
              data-testid="photo-card-id"
              className={field}
              value={projectId}
              disabled={pending}
              placeholder="quote_01"
              onChange={(event) => setProjectId(event.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500">문자, 숫자, '_', '-'만 쓸 수 있습니다. 나중에 이 이름으로 찾습니다.</p>
        </section>

        {/* Said here rather than discovered two screens later. Music is not part of making the card — it is
            chosen at merge time, together with the credit line that some tracks require, and that is the one
            moment where being told about attribution actually changes what a person does. */}
        <p className="text-sm text-slate-400" data-testid="photo-card-music-note">
          음악은 다음 단계(영상 합치기)에서 고릅니다. 저작권 표시가 필요한 음원이면 거기서 알려드립니다.
        </p>

        {error && (
          <p role="alert" data-testid="photo-card-error" data-error-code={error.code} className="text-sm text-rose-400">
            {error.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            data-testid="photo-card-submit"
            disabled={!ready || pending}
            className="rounded-full bg-gradient-to-br from-violet-500 to-pink-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "만드는 중..." : "만들기"}
          </button>
          <button type="button" className={outlineButton} disabled={pending} onClick={onBack}>
            취소
          </button>
        </div>
      </form>
    </section>
  );
}
