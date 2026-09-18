import { useMemo, useState } from "react";

import { checkNewsSummary, type UnverifiedClaim } from "../utils/newsSummaryCheck.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { cardSectionRoomy as cardSection, primaryButton } from "./ui/surfaces.js";

interface Props {
  onBack: () => void;
  /**
   * Hands the verified summary and its source line to the card flow.
   *
   * 🔴 Only ever called with a summary that passed the check. The button that calls it is disabled otherwise,
   * and that is deliberate rather than a warning: a person who is told "this might be wrong" and given a
   * working button presses the button.
   */
  onUseSummary: (quote: string, sourceLine: string) => void;
}

const field = "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600";
const label = "block text-sm text-slate-300";

/** 화면이 못 찾은 것을 무엇이라 부를지 — 사람이 고칠 자리를 가리키는 말로. */
const CLAIM_LABEL: Record<UnverifiedClaim["kind"], string> = {
  number: "숫자",
  date: "날짜",
  quote: "따옴표 안의 말",
};

/**
 * 기사 하나를 릴 한 편으로 — 요약이 기사 안에서만 말하는지 확인한 뒤에.
 *
 * 🔴 이 화면의 존재 이유는 편의가 아니라 **막는 것**입니다. 요약을 AI 에게 시키면 원문에 없는 숫자·날짜·
 * 인용문을 그럴듯하게 지어냅니다. 꽃말 릴이면 시시하지만 뉴스는 틀린 사실이 예쁘게 만들어져 퍼집니다.
 * 그래서 대조를 통과하기 전에는 카드로 넘어가는 버튼이 눌리지 않습니다.
 *
 * 🟠 1단계는 **붙여넣기**입니다. 기사를 앱이 직접 가져오려면 새 외부 주소로 나가야 하고 그건 별도 결정이
 * 필요합니다(어느 언론사를 넣을지 포함). 붙여넣기로 먼저 도는 이유는 게으름이 아니라, **대조 규칙을 실물로
 * 시험할 수 있기 때문**입니다 — 나중에 RSS 가 붙어도 이 화면은 기사가 어디서 왔는지 모르는 채로 그대로
 * 돌아갑니다. 요약도 지금은 사람이 씁니다. 서버가 요약을 만들게 되면 그 결과가 같은 검사를 그대로 지납니다.
 */
export function NewsReelScreen({ onBack, onUseSummary }: Props) {
  const [title, setTitle] = useState("");
  const [articleText, setArticleText] = useState("");
  const [outlet, setOutlet] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [summary, setSummary] = useState("");

  const trimmedSummary = summary.trim();
  const trimmedArticle = articleText.trim();
  const ready = trimmedSummary.length > 0 && trimmedArticle.length > 0;

  /* 글자를 칠 때마다 다시 봅니다 — 순수 함수라 서버도 돈도 안 듭니다. 「확인」 버튼을 따로 두면 사람이
     누르지 않은 채로 넘어갈 수 있고, 그러면 막는 장치가 있으나 마나입니다. */
  const check = useMemo(
    () => (ready ? checkNewsSummary(trimmedSummary, trimmedArticle) : { unverified: [], checked: 0 }),
    [ready, trimmedSummary, trimmedArticle],
  );

  const blocked = check.unverified.length > 0;
  const sourceLine = [outlet.trim(), publishedAt.trim(), sourceUrl.trim()].filter((part) => part.length > 0).join(" · ");

  return (
    <div className="space-y-6">
      <ScreenHeader title="뉴스 릴 만들기" backLabel="돌아가기" onBack={onBack} />

      <section className={cardSection} aria-label="기사">
        <h2 className="text-sm font-semibold text-slate-100">기사</h2>
        <p className="mt-1 text-xs text-slate-500">
          요약이 기사 안에서만 말하는지 대조하려면 <strong className="text-slate-300">본문이 있어야 합니다.</strong> 기사 화면에서 본문을 복사해 붙여넣어 주세요.
        </p>
        <div className="mt-4 space-y-3">
          <label className={label}>
            제목
            <input data-testid="news-title" className={`${field} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className={label}>
            본문
            <textarea
              data-testid="news-article"
              rows={10}
              className={`${field} mt-1`}
              value={articleText}
              onChange={(event) => setArticleText(event.target.value)}
              placeholder="기사 본문을 그대로 붙여넣어 주세요."
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>
              언론사
              <input data-testid="news-outlet" className={`${field} mt-1`} value={outlet} onChange={(event) => setOutlet(event.target.value)} />
            </label>
            <label className={label}>
              발행일
              <input data-testid="news-published" className={`${field} mt-1`} value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} placeholder="2026-09-17" />
            </label>
            <label className={label}>
              원문 링크
              <input data-testid="news-url" className={`${field} mt-1`} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
            </label>
          </div>
        </div>
      </section>

      <section className={cardSection} aria-label="요약">
        <h2 className="text-sm font-semibold text-slate-100">요약</h2>
        <p className="mt-1 text-xs text-slate-500">릴에 들어갈 문장입니다. 첫 줄이 제목처럼 크게 들어갑니다.</p>
        <textarea
          data-testid="news-summary"
          rows={5}
          className={`${field} mt-3`}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="기사가 말하는 것만 적어 주세요."
        />
      </section>

      <section className={cardSection} aria-label="원문 대조">
        <h2 className="text-sm font-semibold text-slate-100">원문 대조</h2>

        {!ready && (
          <p className="mt-2 text-sm text-slate-400" data-testid="news-check-idle">
            기사 본문과 요약을 채우면 여기서 대조합니다.
          </p>
        )}

        {ready && blocked && (
          <div className="mt-3 space-y-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3" data-testid="news-check-failed">
            <p className="text-sm font-semibold text-rose-200">
              요약에 기사에서 찾을 수 없는 것이 {check.unverified.length}개 있습니다.
            </p>
            <ul className="space-y-1">
              {check.unverified.map((claim) => (
                <li key={`${claim.kind}:${claim.text}`} className="text-sm text-rose-200" data-testid={`news-unverified-${claim.kind}`}>
                  {CLAIM_LABEL[claim.kind]} <strong className="font-semibold">{claim.text}</strong> — 기사 본문에 없습니다.
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-300">
              지어낸 값일 수도 있고, 기사에 있는데 다르게 적으신 것일 수도 있습니다. 기사에 적힌 그대로 고치거나, 그 문장을 빼 주세요.
            </p>
          </div>
        )}

        {ready && !blocked && check.checked > 0 && (
          <p className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300" data-testid="news-check-passed">
            요약의 숫자·날짜·인용문 {check.checked}개를 기사 본문에서 찾았습니다.
          </p>
        )}

        {/* 🔴 「검사할 게 없었다」와 「통과했다」는 다른 사실입니다. 숫자도 날짜도 따옴표도 없는 요약은 이
            검사가 아무것도 보지 못한 것이고, 초록으로 칠하면 보지 않은 것을 봤다고 말하는 셈입니다. */}
        {ready && !blocked && check.checked === 0 && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-check-empty">
            이 요약에는 대조할 숫자·날짜·인용문이 없습니다. 막지는 않지만, <strong>확인된 것도 없습니다.</strong>
          </p>
        )}

        {/* 🔴 이 검사의 한계를 화면이 직접 말합니다. 안 적으면 초록 한 줄이 「사실 확인 끝」으로 읽히고,
            그건 이 화면이 막으려던 것보다 더 나쁜 오해입니다. */}
        <p className="mt-3 text-xs text-slate-500" data-testid="news-check-limit">
          이 대조는 <strong className="text-slate-400">기사에 없는 숫자·날짜·인용문</strong>만 잡습니다. 기사에 있는 값을 엉뚱한 곳에 붙였거나 뜻을 뒤집은 것은 못 잡습니다 — 올리기 전에 기사와 한 번 읽어 봐 주세요.
        </p>
      </section>

      <section className={cardSection} aria-label="출처">
        <h2 className="text-sm font-semibold text-slate-100">출처</h2>
        <p className="mt-1 text-xs text-slate-500">화면과 캡션에 이 줄이 같이 들어갑니다. 요약은 기사의 것이지 우리 것이 아닙니다.</p>
        <p className="mt-3 break-all text-sm text-slate-300" data-testid="news-source-line">
          {sourceLine || "언론사·발행일·링크를 채워 주세요."}
        </p>
      </section>

      <button
        type="button"
        data-testid="news-use-summary"
        className={primaryButton}
        disabled={!ready || blocked || sourceLine.length === 0}
        onClick={() => onUseSummary(trimmedSummary, sourceLine)}
      >
        이 요약으로 카드 만들기
      </button>
      {ready && blocked && (
        <p className="text-xs text-slate-500" data-testid="news-use-blocked-why">
          대조에서 걸린 것을 고쳐야 넘어갈 수 있습니다.
        </p>
      )}
    </div>
  );
}
