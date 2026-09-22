import { useEffect, useState, type FormEvent } from "react";
import type { Asset, NewsArticleInput, NewsDailyCallCount, NewsReelCaption, NewsReelCard, PhotoCardDurationSeconds } from "@ai-animation-studio/shared";
import { NEWS_CHECK_SCOPE_NOTICE, checkNewsSummary, newsReelTextBox } from "@ai-animation-studio/shared";

import { listAssets } from "../api/assetsApi.js";
import { NEWS_LEDGER_UNREADABLE_MESSAGE, NewsApiError, createNewsReelCardText, getNewsReelSetup } from "../api/newsApi.js";
import { createNewsReel, toNewsReelDisplayError } from "../api/newsReelsApi.js";
import { listProjects } from "../api/projectsApi.js";
import { assetContentUrl } from "../api/assetsApi.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { CountedField, newsReelFieldValue } from "./ui/CountedField.js";
import { cardSectionRoomy as cardSection, outlineButton, primaryButton } from "./ui/surfaces.js";

/**
 * 앞 화면(기사 + 그림 고르기)이 넘겨주는 것.
 *
 * 🔴 **그림이 먼저 정해져 있습니다.** 자막이 장면마다 하나라, 칸을 몇 개 열지는 `assetIds.length` 가 정합니다 —
 * 그리고 「글 뽑기」도 모델에게 그 수를 말해 줘야 그만큼 받아 옵니다(CLI Round 1067 §1).
 */
export interface NewsReelDraft {
  article: NewsArticleInput;
  assetIds: string[];
  clipDurationSeconds: PhotoCardDurationSeconds;
}

type DisplayError = { code: string; message: string };

/** 서버의 프로젝트 이름 규칙과 같은 것 — 거절이 버튼 뒤가 아니라 칸 옆에 오도록. */
const SAFE_NAME = /^[\p{L}\p{N}_-]+$/u;

const field =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

/** 화면이 못 찾은 것을 무엇이라 부를지. */
const CLAIM_LABEL = { number: "숫자", date: "날짜", quote: "따옴표 안의 말" } as const;

/**
 * 릴에 들어갈 글을 쓰고 릴을 만드는 화면 — **그림마다 자막 하나**.
 *
 * 🔴 **제목 두 줄은 릴 내내 고정, 자막은 장면마다 바뀝니다**(캡틴D 결정). 그래서 이 화면은 그림 목록을 세로로
 * 늘어놓고 **그림 옆에 그 장면의 자막**을 둡니다 — 어느 그림에 무엇이 깔리는지 보이지 않으면, 고쳐야 할 줄을
 * 찾을 수가 없습니다.
 */
export function NewsReelCreateScreen({ draft, onBack, onCreated }: {
  draft: NewsReelDraft | null;
  onBack: () => void;
  onCreated: (projectId: string) => void;
}) {
  const sceneCount = draft?.assetIds.length ?? 0;

  const [headline1, setHeadline1] = useState("");
  const [headline2, setHeadline2] = useState("");
  /* 🔴 **장면 수만큼**입니다. 계약이 `captions.length === assetIds.length` 를 요구하고, 다르면 서버가
     작업을 쓰기 전에 거절합니다(CLI Round 1067 §1). */
  const [captions, setCaptions] = useState<{ line1: string; line2: string }[]>(
    () => Array.from({ length: sceneCount }, () => ({ line1: "", line2: "" })),
  );
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [takenNames, setTakenNames] = useState<ReadonlySet<string> | null>(null);
  const [creditRequired, setCreditRequired] = useState(false);
  const [creditText, setCreditText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  /* 🔴 **이 화면이 돈을 쓰는 유일한 버튼을 들고 있습니다.** 몇 번 남았는지 모르는 채로 열어 두면,
     사람은 마지막 한 번을 모르고 씁니다. 🔴 장부를 못 읽으면(`null`) **여유가 있는 것으로 읽지 않습니다.** */
  const [dailyCalls, setDailyCalls] = useState<NewsDailyCallCount | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [drawNote, setDrawNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAssets()
      .then((response) => { if (!cancelled) setAssets(response.assets); })
      .catch(() => { /* 그림 이름이 안 보일 뿐, 만들기는 그대로 됩니다. */ });
    getNewsReelSetup()
      .then((response) => { if (!cancelled) setDailyCalls(response.dailyCalls); })
      .catch(() => { /* 화면은 그대로 서고, 버튼만 닫힙니다 — 모르면 안 부릅니다. */ });
    listProjects()
      .then((response) => { if (!cancelled) setTakenNames(new Set(response.projects.map((project) => project.id))); })
      .catch(() => { /* 막는 건 서버입니다 — 읽기 한 번 실패가 만들기를 막지 않습니다. */ });
    return () => { cancelled = true; };
  }, []);

  function setCaption(scene: number, line: "line1" | "line2", value: string): void {
    setCaptions((current) => current.map((one, index) => (index === scene ? { ...one, [line]: value } : one)));
  }

  /**
   * 기사 하나로 **제목 두 줄 + 장면마다 자막**을 받아 채웁니다. 🔴 **오늘 쓸 수 있는 횟수를 한 번 씁니다.**
   *
   * 🔴 **받은 값을 안 자릅니다** — 긴 줄은 긴 채로 칸에 들어가고 칸이 빨갛게 셉니다.
   * 🔴 **두 번 온 칸은 안 채웁니다** — 무엇을 뜻했는지 여기서는 알 수 없습니다.
   */
  async function drawCardText(): Promise<void> {
    if (drawing || draft === null || !canDraw) return;
    setDrawing(true);
    setDrawError(null);
    setDrawNote(null);
    try {
      const response = await createNewsReelCardText(draft.article, sceneCount);
      if (response.headline.line1 !== undefined) setHeadline1(response.headline.line1);
      if (response.headline.line2 !== undefined) setHeadline2(response.headline.line2);
      setCaptions((current) => current.map((one, index) => ({
        line1: response.captions[index]?.line1 ?? one.line1,
        line2: response.captions[index]?.line2 ?? one.line2,
      })));
      /* 🟠 **부스러기를 버리지 않습니다** — 돈이 나간 답이고, 못 채운 칸은 사람이 손으로 채울 자리입니다. */
      const leftovers: string[] = [];
      if (response.missing.length > 0) leftovers.push(`안 온 칸 ${response.missing.length}개`);
      if (response.repeated.length > 0) leftovers.push(`두 번 온 칸 ${response.repeated.length}개 — 어느 쪽인지 알 수 없어 비워 뒀습니다`);
      if (response.ignored.length > 0) leftovers.push(`칸에 못 넣은 줄 ${response.ignored.length}개`);
      setDrawNote(leftovers.length > 0 ? leftovers.join(" · ") : null);
    } catch (caught) {
      setDrawError(caught instanceof NewsApiError ? caught.message : "글을 받지 못했습니다.");
      /* 🔴 서버가 한도를 말했으면 제가 들고 있는 수와 관계없이 닫습니다 — 거절은 새 건수를 안 싣고 옵니다. */
      if (caught instanceof NewsApiError && caught.code === "NEWS_DAILY_LIMIT_REACHED") setLimitReached(true);
    } finally {
      setDrawing(false);
    }
  }

  const callsLeft = dailyCalls ? Math.max(0, dailyCalls.limit - dailyCalls.used) : 0;
  const canDraw = dailyCalls !== null && callsLeft > 0 && !limitReached;

  const trimmedId = projectId.trim();
  const nameTaken = takenNames !== null && takenNames.has(trimmedId);
  const nameUsable = trimmedId.length > 0 && SAFE_NAME.test(trimmedId) && !nameTaken;

  /* 🔴 **서버와 같은 함수로 셉니다** — 화면이 통과시킨 카드가 서버에서 거절당하면, 사람은 고칠 곳이 없는 거절을 받습니다. */
  const boxes = [
    newsReelTextBox("headline.line1", newsReelFieldValue(headline1)),
    newsReelTextBox("headline.line2", newsReelFieldValue(headline2)),
    ...captions.flatMap((one) => [
      newsReelTextBox("caption.line1", newsReelFieldValue(one.line1)),
      newsReelTextBox("caption.line2", newsReelFieldValue(one.line2)),
    ]),
  ];
  const refused = boxes.filter((box) => box.refusal !== null);

  /* 🔴 **구워지는 글이 기사 안에서만 말하는지** — 요약이 아니라 이 줄들을 대조합니다. */
  const joined = [headline1, headline2, ...captions.flatMap((one) => [one.line1, one.line2])]
    .map((one) => one.trim()).filter((one) => one.length > 0).join(" ");
  const check = joined.length > 0 && draft !== null && draft.article.body.trim().length > 0
    ? checkNewsSummary(joined, draft.article.body)
    : { claims: [], missing: [] };
  const blocked = check.missing.length > 0;

  const trimmedCredit = creditText.trim();
  const creditMissing = creditRequired && trimmedCredit.length === 0;
  const ready = draft !== null && refused.length === 0 && !blocked && nameUsable && !creditMissing;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!ready || pending || draft === null) return;
    setPending(true);
    setError(null);
    try {
      const built: NewsReelCard = {
        publisher: draft.article.publisher,
        headline: { line1: headline1.trim(), line2: headline2.trim() },
        /* 🔴 빈 둘째 줄은 `""` 가 아니라 `null` — 계약이 빈 문자열을 값으로 안 칩니다(docs/06_DECISIONS.md D-054). */
        captions: captions.map((one): NewsReelCaption => ({ line1: one.line1.trim(), line2: newsReelFieldValue(one.line2) })),
        ...(creditRequired ? { creditRequired: true, creditText: trimmedCredit } : { creditRequired: false }),
      };
      const response = await createNewsReel({
        projectId: trimmedId,
        assetIds: draft.assetIds,
        card: built,
        clipDurationSeconds: draft.clipDurationSeconds,
        aspectRatio: "9:16",
      });
      onCreated(response.project.id);
    } catch (caught) {
      setError(toNewsReelDisplayError(caught));
    } finally {
      setPending(false);
    }
  }

  const assetById = (id: string): Asset | undefined => assets?.find((one) => one.assetId === id);

  if (draft === null) {
    return (
      <section className="mt-8 max-w-3xl space-y-5">
        <ScreenHeader title="릴에 들어갈 글" eyebrow="뉴스 릴" backLabel="뉴스 릴로 돌아가기" onBack={onBack} />
        {/* 🔴 그림이 없으면 자막 칸을 몇 개 열지 모릅니다 — 빈 칸을 지어내면 그림과 안 맞는 카드가 됩니다. */}
        <p className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-reel-create-no-draft">
          기사와 그림이 아직 없습니다. 뉴스 릴 화면에서 기사를 가져오고 그림을 고른 뒤 다시 오십시오.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <ScreenHeader
        title="릴에 들어갈 글"
        eyebrow="뉴스 릴"
        description={`그림 ${sceneCount}장 · 한 장당 ${draft.clipDurationSeconds}초 · 모두 ${sceneCount * draft.clipDurationSeconds}초`}
        backLabel="그림 다시 고르기"
        onBack={onBack}
      />

      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <section aria-label="글 뽑기" className={cardSection}>
          {/* 🔴 **이 버튼이 오늘 쓸 수 있는 횟수를 한 번 씁니다.** */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              data-testid="news-reel-draw"
              className={outlineButton}
              disabled={drawing || pending || !canDraw}
              onClick={() => void drawCardText()}
            >
              {drawing ? "글을 받는 중..." : `기사에서 ${2 + sceneCount}줄 뽑기`}
            </button>
            <span className="text-xs text-slate-500">
              제목 두 줄과 그림 {sceneCount}장의 자막을 한 번에 받습니다 — {dailyCalls ? `누를 때마다 하나씩 씁니다. 오늘 ${callsLeft}번 남았습니다.` : "누를 때마다 오늘 쓸 수 있는 횟수를 하나 씁니다."}
            </span>
          </div>
          {/* 🔴 「모르니까 안 부른다」입니다 — 숫자를 비워 두거나 0 으로 그리면 「여유 있음」으로 읽힙니다. */}
          {dailyCalls === null && (
            <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-reel-calls-unknown">
              {NEWS_LEDGER_UNREADABLE_MESSAGE}
            </p>
          )}
          {dailyCalls !== null && !canDraw && (
            <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-reel-calls-spent">
              오늘 쓸 수 있는 횟수를 다 썼습니다. 이 앱이 막고 있는 것이고, 내일 다시 쓰실 수 있습니다. 글은 직접 쓰셔도 됩니다.
            </p>
          )}
          {drawError && (
            <p role="alert" className="mt-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" data-testid="news-reel-draw-error">
              {drawError}
            </p>
          )}
          {drawNote && (
            <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-300" data-testid="news-reel-draw-leftovers">
              {drawNote} — 직접 채워 주세요.
            </p>
          )}
        </section>

        <section aria-label="제목" className={cardSection}>
          <h2 className="text-sm font-semibold text-slate-100">제목 (릴 내내 고정)</h2>
          <p className="mt-1 text-xs text-slate-500">
            두 줄은 <strong className="text-slate-300">색이 갈립니다</strong> — 첫 줄 흰색, 둘째 줄 노란색. 어디서 끊을지는 사람이 정합니다.
          </p>
          <div className="mt-3 space-y-3">
            <CountedField id="news-reel-headline1" data-testid="news-reel-headline1" field="headline.line1" label="첫 줄 (흰색)" value={headline1} onChange={setHeadline1} disabled={pending} placeholder="무슨 일인지" />
            <CountedField id="news-reel-headline2" data-testid="news-reel-headline2" field="headline.line2" label="둘째 줄 (노란색)" value={headline2} onChange={setHeadline2} disabled={pending} placeholder="그래서 어떻게 됐는지" />
          </div>
        </section>

        {/* 🔴 **그림 옆에 그 장면의 자막.** 어느 그림에 무엇이 깔리는지 안 보이면, 고칠 줄을 못 찾습니다. */}
        <section aria-label="장면마다 자막" className={cardSection}>
          <h2 className="text-sm font-semibold text-slate-100">장면마다 자막</h2>
          <p className="mt-1 text-xs text-slate-500">그림이 바뀌면 아래 자막도 바뀝니다. 제목 띠는 그대로 있습니다.</p>

          <ol className="mt-4 space-y-5">
            {captions.map((one, scene) => {
              const asset = assetById(draft.assetIds[scene]!);
              return (
                <li key={draft.assetIds[scene]} className="flex gap-3" data-testid={`news-reel-scene-${scene}`}>
                  <div className="flex w-24 flex-shrink-0 flex-col gap-1">
                    <span className="type-mono text-[11px] text-bone-faint">{scene + 1}번째</span>
                    {asset?.imageAvailable === true && (
                      <img src={assetContentUrl(asset.assetId)} alt="" className="w-full rounded-lg border border-white/10 object-cover" />
                    )}
                    <span className="truncate text-[11px] text-slate-500">{asset?.displayName ?? "그림"}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <CountedField
                      id={`news-reel-caption1-${scene}`}
                      data-testid={`news-reel-caption1-${scene}`}
                      field="caption.line1"
                      label="자막 첫 줄"
                      value={one.line1}
                      onChange={(value) => setCaption(scene, "line1", value)}
                      disabled={pending}
                      placeholder="이 그림에 보이는 것을 말로"
                    />
                    <CountedField
                      id={`news-reel-caption2-${scene}`}
                      data-testid={`news-reel-caption2-${scene}`}
                      field="caption.line2"
                      label="자막 둘째 줄"
                      value={one.line2}
                      onChange={(value) => setCaption(scene, "line2", value)}
                      disabled={pending}
                      placeholder="없어도 됩니다"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* 🔴 구워지는 글이 기사 안에서만 말하는지 — 걸리면 못 만듭니다. */}
        {blocked && (
          <div role="alert" className="space-y-1 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" data-testid="news-reel-check-failed">
            <p>이 글에 <strong>기사에서 못 찾은 것</strong>이 있습니다 — 고쳐야 만들 수 있습니다.</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {check.missing.map((claim) => (
                <li key={`${claim.kind}-${claim.text}`} data-testid={`news-reel-check-missing-${claim.text}`}>
                  {CLAIM_LABEL[claim.kind]} 「{claim.text}」
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* 🔴 초록 한 줄이 「사실 확인 끝」으로 읽히지 않게, 한계는 늘 적혀 있습니다. */}
        <p className="text-xs text-slate-500" data-testid="news-reel-check-limit">{NEWS_CHECK_SCOPE_NOTICE}</p>

        <section aria-label="그림 출처" className={cardSection}>
          <h2 className="text-sm font-semibold text-slate-100">그림 출처</h2>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" data-testid="news-reel-create-credit-required" className="mt-1" checked={creditRequired} disabled={pending} onChange={(event) => setCreditRequired(event.target.checked)} />
            <span>이 그림은 출처를 밝혀야 합니다 (공공누리 · 위키미디어 CC BY 등)</span>
          </label>
          {creditRequired && (
            <label className="mt-3 block text-sm text-slate-300">
              출처 문구
              <input data-testid="news-reel-create-credit-text" className={field} value={creditText} disabled={pending} onChange={(event) => setCreditText(event.target.value)} placeholder="출처가 요구하는 문장을 그대로 붙여넣어 주세요" />
              {/* 🔴 지어내면 어느 라이선스도 만족시키지 못합니다. */}
              <span className="mt-1 block text-xs text-slate-500">라이선스가 적어 둔 문장을 그대로 옮겨 주세요. 저희가 지어내지 않습니다.</span>
            </label>
          )}
          {creditMissing && (
            <p className="mt-2 text-xs text-amber-300" data-testid="news-reel-create-credit-missing">
              출처가 필요하다고 하셨는데 문구가 비어 있습니다. 비운 채로는 만들지 않습니다.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">Pexels · Unsplash 사진은 출처가 필요 없습니다. 기사 사진은 쓰지 않습니다.</p>
        </section>

        <section aria-label="이름" className={cardSection}>
          <label className="block text-sm text-slate-300">
            이름
            <input data-testid="news-reel-create-name" className={field} value={projectId} disabled={pending} onChange={(event) => setProjectId(event.target.value)} placeholder="검찰청폐지-0922" />
          </label>
          {trimmedId.length > 0 && !SAFE_NAME.test(trimmedId) && (
            <p className="mt-1 text-xs text-amber-300" data-testid="news-reel-create-name-unsafe">
              이름에는 문자, 숫자, &apos;_&apos;, &apos;-&apos; 만 쓸 수 있습니다. 띄어쓰기와 괄호는 안 됩니다.
            </p>
          )}
          {nameTaken && (
            <p className="mt-1 text-xs text-amber-300" data-testid="news-reel-create-name-taken">이 이름은 이미 있습니다. 다른 이름을 써 주세요.</p>
          )}
          <p className="mt-3 text-xs text-slate-500" data-testid="news-reel-create-ratio">화면 비율은 9:16 세로입니다.</p>
        </section>

        {error && (
          <p role="alert" data-error-code={error.code} className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" data-testid="news-reel-create-error">
            {error.message}
          </p>
        )}

        <button type="submit" data-testid="news-reel-create-submit" className={primaryButton} disabled={!ready || pending}>
          {pending ? "만드는 중..." : "릴 만들기"}
        </button>
        {!ready && !pending && (
          <p className="text-xs text-slate-500" data-testid="news-reel-create-why">
            {refused.length > 0 ? "글자 수가 맞지 않는 칸이 있습니다."
              : blocked ? "대조에서 걸린 것을 고쳐야 만들 수 있습니다."
              : creditMissing ? "출처 문구를 적어 주세요."
              : "쓸 수 있는 이름을 적어 주세요."}
          </p>
        )}
      </form>
    </section>
  );
}
