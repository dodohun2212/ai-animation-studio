import { useEffect, useState, type FormEvent } from "react";
import type { Asset, NewsReelCard, PhotoCardDurationSeconds } from "@ai-animation-studio/shared";
import { NEWS_REEL_TEXT_FIELDS, PHOTO_CARD_DURATIONS, PHOTO_CARD_MAX_PICTURES, newsReelTextBox } from "@ai-animation-studio/shared";

import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { createNewsReel, toNewsReelDisplayError } from "../api/newsReelsApi.js";
import { listProjects, toDisplayError } from "../api/projectsApi.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { PicturePicker, type PicturePickerError } from "./ui/PicturePicker.js";
import { cardSectionRoomy as cardSection, primaryButton } from "./ui/surfaces.js";

/**
 * 뉴스 릴 화면이 넘겨주는 것 — **글과 언론사까지**입니다.
 *
 * 🔴 출처 두 칸(`creditRequired`/`creditText`)은 **여기 없습니다.** 그건 글에 딸린 게 아니라 **그림에 딸린
 * 것**이고, 그림은 이 화면에서 고릅니다. 글 쓰는 화면에서 그림의 출처를 물으면, 아직 고르지도 않은 그림에
 * 대해 답하게 됩니다(docs/06_DECISIONS.md D-054).
 */
export type NewsReelCardText = Omit<NewsReelCard, "creditRequired" | "creditText">;

interface Props {
  /**
   * 뉴스 릴 화면에서 채운 네 줄과 언론사. **없이 열리면 만들 것이 없습니다.**
   *
   * 🔴 `null` 을 빈 글로 바꾸지 않습니다 — 빈 네 줄로 릴을 구우면 **띠만 있고 글이 없는 영상**이 나오고,
   * 그건 실패처럼 안 보입니다.
   */
  text: NewsReelCardText | null;
  onBack: () => void;
  /** 만들어지면 병합 화면으로 — 음악과 출처 줄이 거기 삽니다. */
  onCreated: (projectId: string) => void;
}

type DisplayError = PicturePickerError;

/** 서버의 프로젝트 이름 규칙(`SAFE_PROJECT_ID_PATTERN`)과 같은 것 — 거절이 버튼 뒤가 아니라 칸 옆에 오도록. */
const SAFE_NAME = /^[\p{L}\p{N}_-]+$/u;

const field =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

/**
 * 뉴스 릴 만들기 — 보관함 그림 위에 **카드 한 장**을 굽습니다.
 *
 * 🔴 **명언 카드 화면과 따로입니다.** 받는 값이 `quote` 하나가 아니라 넷이고, 두 줄은 **색이 갈립니다**
 * (docs/06_DECISIONS.md D-052). 한 화면에 두면 그 화면이 **「지금 둘 중 뭘 만드나」를 매번** 물어야 합니다.
 *
 * 🟢 **그림 고르개는 같은 것을 씁니다**(`PicturePicker`) — 갈라야 하는 건 계약이지 격자가 아닙니다.
 *
 * 🔴 **비율은 9:16 으로 고정입니다.** 릴은 세로이고, 굽는 층의 기하(`newsReelCardGeometry`)가 1080×1920 을
 * 전제로 띠와 네 줄의 자리를 잡습니다 — 고르게 열어 두면 **고를 수 있는데 안 맞는 값**이 생깁니다.
 */
export function NewsReelCreateScreen({ text, onBack, onCreated }: Props) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [listError, setListError] = useState<DisplayError | null>(null);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [seconds, setSeconds] = useState<PhotoCardDurationSeconds>(PHOTO_CARD_DURATIONS[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [takenNames, setTakenNames] = useState<ReadonlySet<string> | null>(null);
  /* 🔴 **그림에 딸린 것**입니다. 공공누리 제1유형은 출처를, 위키미디어 CC BY 는 저작자와 라이선스를 요구하고,
     Pexels·Unsplash 는 아무것도 요구하지 않습니다 — 그래서 **켜고 끄는 것**이지 늘 채우는 칸이 아닙니다. */
  const [creditRequired, setCreditRequired] = useState(false);
  /* 🔴 **우리가 지어내지 않습니다.** 라이선스가 요구하는 문장을 **그대로 옮겨 적는** 칸입니다 — 조합하면
     어느 쪽도 만족시키지 못합니다(docs/06_DECISIONS.md D-054). */
  const [creditText, setCreditText] = useState("");

  useEffect(() => {
    let cancelled = false;
    listAssets()
      .then((response) => { if (!cancelled) setAssets(response.assets.filter((asset) => !asset.isFolder && asset.imageAvailable)); })
      .catch((caught: unknown) => { if (!cancelled) setListError(toAssetDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    /* 🟠 이름이 겹치는지 **미리** 보려는 것뿐입니다. 막는 건 서버고, 이 읽기가 실패해도 버튼은 엽니다. */
    listProjects()
      .then((response) => { if (!cancelled) setTakenNames(new Set(response.projects.map((project) => project.id))); })
      .catch(() => { /* 서버가 여전히 거절합니다 — 여기서 막으면 읽기 한 번 실패가 만들기를 막습니다. */ });
    return () => { cancelled = true; };
  }, []);

  function togglePicture(id: string): void {
    setAssetIds((current) => {
      if (current.includes(id)) return current.filter((one) => one !== id);
      if (current.length >= PHOTO_CARD_MAX_PICTURES) return current;
      return [...current, id];
    });
  }

  const trimmedId = projectId.trim();
  const nameTaken = takenNames !== null && takenNames.has(trimmedId);
  const nameUsable = trimmedId.length > 0 && SAFE_NAME.test(trimmedId) && !nameTaken;
  /* 🔴 **서버와 같은 함수로 셉니다.** 화면이 통과시킨 카드가 서버에서 거절당하면, 사람은 **고칠 곳이 없는
     거절**을 받습니다(서버가 같은 자리에서 거절합니다). */
  const refused = text === null
    ? []
    : NEWS_REEL_TEXT_FIELDS.map((one) => newsReelTextBox(one, one === "caption.line2" ? text.caption.line2
      : one === "caption.line1" ? text.caption.line1
      : one === "headline.line2" ? text.headline.line2
      : text.headline.line1)).filter((box) => box.refusal !== null);
  const trimmedCredit = creditText.trim();
  /* 🔴 **출처가 필요한데 문구가 비어 있으면 안 만듭니다.** 서버도 같은 자리에서 거절하는데, 여기서 막는 이유는
     이 지점을 지나면 그림이 **사람이 올릴 수 있는 파일 안**으로 들어가기 때문입니다(서버가 같은 자리에서 거절합니다). */
  const creditMissing = creditRequired && trimmedCredit.length === 0;
  const ready = text !== null && refused.length === 0 && assetIds.length > 0 && nameUsable && !creditMissing;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!ready || pending || text === null) return;
    setPending(true);
    setError(null);
    try {
      const response = await createNewsReel({
        projectId: trimmedId,
        assetIds,
        /* 🟠 `creditText` 는 **켜져 있을 때만** 실립니다 — 꺼진 채 남은 글자를 같이 보내면 계약이
           「필요 없는데 문구가 있는」 모양을 받게 됩니다. */
        card: creditRequired ? { ...text, creditRequired: true, creditText: trimmedCredit } : { ...text, creditRequired: false },
        clipDurationSeconds: seconds,
        aspectRatio: "9:16",
      });
      onCreated(response.project.id);
    } catch (caught) {
      setError(toNewsReelDisplayError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <ScreenHeader
        title="뉴스 릴 만들기"
        eyebrow="뉴스 릴"
        description="고른 그림 위에 제목 두 줄과 아래 자막을 굽습니다."
        backLabel="뉴스 릴로 돌아가기"
        onBack={onBack}
      />

      <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300" data-testid="news-reel-create-scope">
        여기서는 돈이 나가지 않습니다 — 이미 보관함에 있는 그림을 쓰고, 굽는 것은 이 컴퓨터의 프로그램입니다.
      </p>

      {/* 🔴 **글 없이 열린 경우.** 빈 카드로 만들 수 있게 두면 **띠만 있고 글이 없는 영상**이 나오는데,
          그건 실패처럼 보이지 않아서 게시까지 갑니다. */}
      {text === null ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="news-reel-create-no-card">
          릴에 넣을 네 줄이 아직 없습니다. 뉴스 릴 화면에서 제목 두 줄과 자막을 채운 뒤 다시 오십시오.
        </p>
      ) : (
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <section aria-label="릴에 구워질 글" className={cardSection}>
            <h2 className="text-sm font-semibold text-slate-100">릴에 구워질 글</h2>
            {/* 🟠 여기서는 **고칠 수 없습니다** — 고치는 자리는 뉴스 릴 화면의 칸이고, 거기서 글자 수를 셉니다.
                두 군데서 고칠 수 있으면 **어느 쪽이 구워진 글인지** 사람이 못 압니다. */}
            <dl className="mt-3 space-y-2 text-sm" data-testid="news-reel-create-card">
              {/* 🔴 **띠에 박히는 이름**입니다 — 구워지는 값인데 여기 없으면, 무엇이 나갈지 모른 채 누르게 됩니다. */}
              <div>
                <dt className="text-xs text-slate-500">언론사 (위 띠)</dt>
                <dd className="text-slate-100" data-testid="news-reel-create-publisher">{text.publisher}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">제목</dt>
                <dd className="text-slate-100">{text.headline.line1}</dd>
                <dd className="text-amber-300">{text.headline.line2}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">자막</dt>
                <dd className="text-slate-300">{text.caption.line1}</dd>
                {text.caption.line2 !== null && <dd className="text-slate-300">{text.caption.line2}</dd>}
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">고치시려면 뉴스 릴 화면으로 돌아가십시오 — 글자 수는 거기서 셉니다.</p>
            {refused.length > 0 && (
              <p role="alert" className="mt-3 text-xs text-rose-300" data-testid="news-reel-create-refused">
                글자 수가 맞지 않는 칸이 있습니다. 뉴스 릴 화면에서 고쳐 주세요.
              </p>
            )}
          </section>

          <PicturePicker
            assets={assets}
            listError={listError}
            assetIds={assetIds}
            onToggle={togglePicture}
            max={PHOTO_CARD_MAX_PICTURES}
            seconds={seconds}
            disabled={pending}
            testIdPrefix="news-reel-create"
          />

          {/* 🔴 **그림 바로 아래**입니다 — 출처는 그림에 딸린 것이고, 멀리 두면 다른 그림을 고르고도
              앞 그림의 문구가 남아 있게 됩니다. */}
          <section aria-label="그림 출처" className={cardSection}>
            <h2 className="text-sm font-semibold text-slate-100">그림 출처</h2>
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                data-testid="news-reel-create-credit-required"
                className="mt-1"
                checked={creditRequired}
                disabled={pending}
                onChange={(event) => setCreditRequired(event.target.checked)}
              />
              <span>이 그림은 출처를 밝혀야 합니다 (공공누리 · 위키미디어 CC BY 등)</span>
            </label>
            {creditRequired && (
              <label className="mt-3 block text-sm text-slate-300">
                출처 문구
                <input
                  data-testid="news-reel-create-credit-text"
                  className={field}
                  value={creditText}
                  disabled={pending}
                  onChange={(event) => setCreditText(event.target.value)}
                  placeholder="출처가 요구하는 문장을 그대로 붙여넣어 주세요"
                />
                {/* 🔴 지어내면 어느 라이선스도 만족시키지 못합니다 — 요구하는 문장을 **그대로** 옮깁니다. */}
                <span className="mt-1 block text-xs text-slate-500">
                  라이선스가 적어 둔 문장을 그대로 옮겨 주세요. 저희가 지어내지 않습니다.
                </span>
              </label>
            )}
            {creditMissing && (
              <p className="mt-2 text-xs text-amber-300" data-testid="news-reel-create-credit-missing">
                출처가 필요하다고 하셨는데 문구가 비어 있습니다. 비운 채로는 만들지 않습니다.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Pexels · Unsplash 사진은 출처가 필요 없습니다. 기사 사진은 쓰지 않습니다.
            </p>
          </section>

          <section aria-label="이름과 길이" className={cardSection}>
            <label className="block text-sm text-slate-300">
              이름
              <input
                data-testid="news-reel-create-name"
                className={field}
                value={projectId}
                disabled={pending}
                onChange={(event) => setProjectId(event.target.value)}
                placeholder="검찰청폐지-0921"
              />
            </label>
            {/* 🟠 규칙을 **누르기 전에** 말합니다 — 서버는 「입력 내용을 확인해 주세요」밖에 못 합니다. */}
            {trimmedId.length > 0 && !SAFE_NAME.test(trimmedId) && (
              <p className="mt-1 text-xs text-amber-300" data-testid="news-reel-create-name-unsafe">
                이름에는 문자, 숫자, &apos;_&apos;, &apos;-&apos; 만 쓸 수 있습니다. 띄어쓰기와 괄호는 안 됩니다.
              </p>
            )}
            {nameTaken && (
              <p className="mt-1 text-xs text-amber-300" data-testid="news-reel-create-name-taken">
                이 이름은 이미 있습니다. 다른 이름을 써 주세요.
              </p>
            )}

            <label className="mt-4 block text-sm text-slate-300">
              한 장당 길이
              <select
                data-testid="news-reel-create-seconds"
                className={field}
                value={seconds}
                disabled={pending}
                onChange={(event) => setSeconds(Number(event.target.value) as PhotoCardDurationSeconds)}
              >
                {PHOTO_CARD_DURATIONS.map((value) => <option key={value} value={value}>{value}초</option>)}
              </select>
            </label>

            {/* 🔴 고르게 하지 않습니다 — 굽는 기하가 1080×1920 을 전제로 띠와 네 줄의 자리를 잡습니다. */}
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
            /* 🟠 못 누르는 이유를 말합니다 — 닫힌 버튼만 두면 화면이 고장 난 것으로 읽힙니다. */
            <p className="text-xs text-slate-500" data-testid="news-reel-create-why">
              {assetIds.length === 0 ? "그림을 한 장 이상 고르시면 만들 수 있습니다."
                : !nameUsable ? "쓸 수 있는 이름을 적어 주세요."
                : creditMissing ? "출처 문구를 적어 주세요."
                : "릴 문구를 고쳐 주세요."}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
