import { useEffect, useState, type FormEvent } from "react";
import type { Asset, AspectRatio, PhotoCardDurationSeconds } from "@ai-animation-studio/shared";
import { PHOTO_CARD_MAX_PICTURES, PHOTO_CARD_DURATIONS, PHOTO_CARD_QUOTE_MAX_LENGTH } from "@ai-animation-studio/shared";

import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { createPhotoCard, toPhotoCardDisplayError } from "../api/photoCardsApi.js";
import { listProjects, toDisplayError } from "../api/projectsApi.js";
import { Spinner } from "./Spinner.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { cardSectionRoomy as cardSection, outlineButton } from "./ui/surfaces.js";

interface Props {
  onBack: () => void;
  /** Where to go once the card exists: its merge screen, which is where music and the credit line live. */
  onCreated: (projectId: string) => void;
  /**
   * Where a card that already exists opens.
   *
   * Required, not optional. Cards no longer appear in 단기 프로젝트 — this screen is the only door to them,
   * and an optional callback would let a caller render rows that go nowhere.
   */
  onOpenCard: (projectId: string) => void;
  /**
   * 뉴스 화면이 넘겨준, **대조를 통과한** 요약. 없으면 빈 칸으로 시작합니다.
   *
   * 🔴 한 번만 채웁니다 — 넘어온 뒤 사람이 고친 글을 다시 덮으면, 고친 것이 말없이 사라집니다.
   */
  /**
   * 🔴 뉴스 릴에서 넘어왔나. 만드는 일은 같고 **부르는 이름이 다릅니다** — 캡틴D가 뉴스 릴을 만들다
   * 「명언 카드」라고 적힌 화면에 떨어지면, 잘못 눌렀다고 읽습니다.
   */
  fromNewsReel?: boolean;
  initialQuote?: string;
  /**
   * 출처 한 줄(언론사 · 발행일 · 링크). 요약과 **같이** 와야 합니다.
   *
   * 🔴 남의 기사를 줄여 만든 카드에서 출처가 빠지면 그건 우리 글인 척하는 것입니다. 그래서 이 화면은
   * 받은 줄을 보여 주고, 캡션에 그대로 들어간다고 말합니다.
   */
  initialCaptionNote?: string;
}

type DisplayError = { code: string; message: string };

/**
 * The server's own rule for a project id (project-id.ts's SAFE_PROJECT_ID_PATTERN), repeated so the refusal
 * lands next to the field instead of after the button.
 *
 * `\p{L}` is any Unicode letter, so a Korean name is fine — what actually gets rejected is brackets, spaces
 * and punctuation, which is exactly what someone reaches for naming a card 명언(불광불급). The server answered
 * only "입력 내용을 확인해 주세요", naming neither the field nor the character.
 */
const SAFE_NAME = /^[\p{L}\p{N}_-]+$/u;

const field =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

/**
 * A quote over a picture, made from a picture the app already has.
 *
 * The whole flow existed before this screen — the merge burns the text as a subtitle, the audio library holds
 * the music, the publish screen posts the result. What was missing was the front door: making one meant
 * creating a project, writing a script, approving mappings, generating images and videos, and only then typing
 * the line. This screen is that front door and nothing more; it hands the finished card to the merge screen,
 * which is where music and its credit line already live and where they will keep living.
 */
export function PhotoCardScreen({ fromNewsReel = false, onBack, onCreated, onOpenCard, initialQuote, initialCaptionNote }: Props) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [listError, setListError] = useState<DisplayError | null>(null);
  /**
   * 고른 그림들 — **순서가 곧 장면 순서**입니다.
   *
   * 🔴 `Set` 이 아니라 배열인 이유가 여기 있습니다. 계약이 *「in the order they are shown — one scene each」*
   * 라, 고른 순서가 그대로 재생 순서가 됩니다. `Set` 으로 담으면 순서가 **삽입 순서라는 우연**에 기대게 되고,
   * 나중에 누가 정렬 한 줄만 넣어도 **영상의 순서가 조용히 바뀝니다.**
   */
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [quote, setQuote] = useState(initialQuote ?? "");
  const [seconds, setSeconds] = useState<PhotoCardDurationSeconds>(PHOTO_CARD_DURATIONS[0]);
  // Was a `vertical` boolean (9:16 vs 16:9 only) — item 6 gave `AspectRatio` two more members (1:1, then 4:5),
  // and a boolean has no way to hold a third or fourth value. Carrying the real `AspectRatio` here, the same
  // type `CreatePhotoCardRequest.aspectRatio` already takes, means a fifth aspect ratio is a decision at the
  // <option> list below rather than a silent "everything not 9:16 is 16:9" the boolean would have forced.
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  /**
   * Names already in use, so "이 이름은 이미 있습니다" lands next to the field instead of arriving as a failure.
   *
   * The server does refuse a duplicate — a plain mkdir on the project directory either wins or returns EEXIST —
   * but the photo-card path wraps every one of its failures in PHOTO_CARD_STORAGE_ERROR, so the second press on
   * a name that worked the first time says "사진 카드를 저장하지 못했습니다" about a card that is sitting on disk,
   * finished. photoCardsApi already carries the right sentence for PROJECT_ALREADY_EXISTS; nothing sends it.
   *
   * This is not the guard and is not treated as one: the listing is a snapshot, it need not name every project
   * on disk, and the server's refusal stays where it is. It only stops the confusing press.
   */
  const [takenNames, setTakenNames] = useState<ReadonlySet<string> | null>(null);
  /**
   * 🟠 이름 읽기가 실패했다는 사실.
   *
   * 전에는 이 화면이 **만들어 둔 카드 목록**도 같이 그렸고, 그래서 이 실패가 「끝난 일이 안 보인다」를
   * 뜻했습니다. 목록이 `PhotoCardListScreen` 으로 나간 지금, 여기서 이게 뜻하는 건 하나뿐입니다 —
   * **이름이 겹치는지 미리 못 본다.** 막는 건 여전히 서버라, 버튼은 열어 두고 말만 합니다.
   */
  const [namesError, setNamesError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAssets()
      .then((response) => { if (!cancelled) setAssets(response.assets.filter((asset) => !asset.isFolder && asset.imageAvailable)); })
      .catch((caught: unknown) => { if (!cancelled) setListError(toAssetDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      // Failing to read the list is not a reason to block the button: the server still refuses duplicates.
      .then((response) => {
        if (cancelled) return;
        setTakenNames(new Set(response.projects.map((project) => project.id)));
      })
      .catch((caught: unknown) => { if (!cancelled) setNamesError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  const trimmedQuote = quote.trim();
  const trimmedId = projectId.trim();
  const nameTaken = takenNames !== null && takenNames.has(trimmedId);
  const nameUsable = trimmedId.length > 0 && SAFE_NAME.test(trimmedId) && !nameTaken;
  const atLimit = assetIds.length >= PHOTO_CARD_MAX_PICTURES;
  /**
   * 🔴 **상한에 닿아도 빼는 것은 늘 열려 있습니다.** 「12장이 찼다」를 이유로 버튼 전체를 닫으면, 잘못 고른
   * 한 장을 **바꿀 수가 없어서** 사람이 갇힙니다 — 나가는 길은 폼을 다시 채우는 것뿐이고요. 닫히는 것은
   * **아직 안 고른 것**뿐입니다.
   */
  function togglePicture(id: string): void {
    setAssetIds((current) => {
      if (current.includes(id)) return current.filter((one) => one !== id);
      if (current.length >= PHOTO_CARD_MAX_PICTURES) return current;
      return [...current, id];
    });
  }

  /**
   * 🟠 **고르는 것이 곧 길이를 고르는 것입니다**(계약 주석, CLI Round 950).
   *
   * 카드는 예전엔 장면 하나라 길이가 곧 그 한 장의 유지 시간이었습니다. 이제 사진마다 장면 하나라
   * **장수 × 한 장당 길이**가 완성 길이입니다. 이걸 화면이 말하지 않으면, 세 장을 고른 사람은 10초짜리를
   * 기대하고 30초를 받습니다 — 그리고 그건 **다 구워진 뒤에야** 압니다.
   */
  const totalSeconds = assetIds.length * seconds;
  const ready = assetIds.length > 0 && trimmedQuote.length > 0 && nameUsable && trimmedQuote.length <= PHOTO_CARD_QUOTE_MAX_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await createPhotoCard({
        projectId: trimmedId,
        // 고른 순서 그대로. 정렬하지 않습니다 — 순서가 장면 순서입니다.
        assetIds,
        quote: trimmedQuote,
        clipDurationSeconds: seconds,
        aspectRatio,
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
      {/*
        * 🔴 이 화면은 이제 **만드는 일 하나만** 합니다. 만들어 둔 카드 목록은 `PhotoCardListScreen` 으로
        * 나갔습니다 — 카드 한 장 보려고 들어온 사람이 만들기 폼을 전부 지나가야 했기 때문입니다.
        * 돌아가기가 목록으로 가는 것도 그래서입니다(프로젝트 목록이 아니라).
        */}
      {/* 🔴 같은 화면이 두 가지를 만듭니다. 이름을 안 바꾸면 뉴스 릴을 만들던 사람이 「명언 카드」에
          떨어져 **잘못 눌렀다고 읽습니다** — 캡틴D가 실제로 그렇게 읽으셨습니다. */}
      <ScreenHeader
        title={fromNewsReel ? "뉴스 릴 카드 만들기" : "새 명언 카드"}
        backLabel={fromNewsReel ? "뉴스 릴로" : "명언 카드로"}
        onBack={onBack}
      />
      <p className="text-sm text-slate-400">
        보관함의 그림에 문장을 얹어 짧은 영상으로 만듭니다. 그림을 여러 장 고르시면 고른 순서대로 이어 붙습니다. 그림은 이미 만들어 둔 것을 그대로 쓰기 때문에{" "}
        <span className="font-semibold text-slate-100">여기서는 돈이 나가지 않습니다.</span>
      </p>

      {/*
        * 🟠 「이름이 겹치는지 못 봤다」만 말합니다 — 만들기를 막지 않습니다. 겹치면 서버가 거절하고, 그
        * 거절은 이 화면이 없어도 제 몫을 합니다. 여기서 막으면 **읽기 한 번 실패한 것이 만들기를 막는** 게
        * 되고, 그건 이 화면이 할 수 있는 일보다 큰 말입니다.
        */}
      {namesError && (
        <p role="alert" data-testid="photo-card-names-unchecked" data-error-code={namesError.code} className="text-sm text-amber-300">
          이름이 이미 쓰이고 있는지 미리 확인하지 못했습니다. 만드는 것은 그대로 되고, 겹치면 저장할 때 서버가 알려 줍니다.
        </p>
      )}

      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <section aria-label="그림 고르기" className={cardSection}>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
            <span aria-hidden="true" className="h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
            그림 고르기
          </h2>
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
                const order = assetIds.indexOf(asset.assetId);
                const picked = order >= 0;
                // 🔴 이미 고른 것은 상한과 무관하게 계속 누를 수 있습니다 — 그 누름은 「빼기」입니다.
                const closed = pending || (!picked && atLimit);
                return (
                  <li key={asset.assetId}>
                    <button
                      type="button"
                      data-testid={`photo-card-asset-${asset.assetId}`}
                      data-pick-order={picked ? order + 1 : undefined}
                      aria-pressed={picked}
                      disabled={closed}
                      className={`relative w-full space-y-1 rounded-xl border p-1.5 text-left disabled:opacity-40 ${picked ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 hover:bg-white/5"}`}
                      onClick={() => togglePicture(asset.assetId)}
                    >
                      {asset.contentUrl && (
                        <img src={asset.contentUrl} alt={asset.displayName} className="w-full rounded-xl border border-white/10 object-cover" />
                      )}
                      {/*
                        * 🔴 번호는 「골랐다」가 아니라 **「몇 번째로 나온다」**를 말합니다. 체크 표시로 그리면
                        * 순서를 정한 줄도 모른 채 고르게 되고, 순서는 **되돌릴 수 없는 결과**(영상)에 그대로
                        * 실립니다. 색만으로 상태를 말하지 않는다는 §6 도 이 번호가 같이 지킵니다.
                        */}
                      {picked && (
                        <span
                          data-testid={`photo-card-order-${asset.assetId}`}
                          className="type-mono absolute left-3 top-3 flex h-5 min-w-5 items-center justify-center rounded bg-ground/85 px-1 text-[11px] font-semibold text-bone"
                        >
                          {order + 1}
                        </span>
                      )}
                      <span className="block truncate text-xs text-slate-300">{asset.displayName}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/*
            * 🟠 이 두 줄이 이 화면에서 **고른 결과를 말하는 유일한 자리**입니다. 그림 격자는 무엇을 골랐는지만
            * 보여 주지, 그게 무엇이 되는지는 말하지 않습니다.
            */}
          <p className="text-xs text-slate-400 tabular-nums" data-testid="photo-card-length">
            {assetIds.length === 0
              ? "아직 고른 그림이 없습니다. 고른 순서대로 한 장씩 이어 붙습니다."
              : `사진 ${assetIds.length}장 × 한 장당 ${seconds}초 = ${totalSeconds}초`}
          </p>
          {atLimit && (
            /* 🔴 「더 못 고른다」만 말하면 사람은 화면이 고장 난 줄 압니다. 왜 닫혔는지와 **어떻게 여는지**를
               같이 말합니다 — 여는 방법은 고른 것을 다시 눌러 빼는 것입니다. */
            <p className="text-xs text-amber-300" data-testid="photo-card-limit">
              한 카드에 {PHOTO_CARD_MAX_PICTURES}장까지입니다. 다른 그림을 넣으시려면 고른 것을 다시 눌러 빼 주세요.
            </p>
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
          {/*
            🔴 뉴스 화면에서 넘어온 카드에만 뜹니다. 남의 기사를 줄여 만든 글에서 출처가 빠지면 그건 우리
            글인 척하는 것이라, **어디서 왔는지를 이 화면이 계속 들고 있어야** 합니다 — 넘어온 뒤 이 화면에서
            글을 고치는 동안에도요.
            🟠 그리고 대조는 **넘어온 그 문장**에 대해 통과한 것입니다. 여기서 글을 고치면 그 통과는 고친
            문장에 대해서는 아무 말도 하지 않습니다. 그 말을 안 하면 사람은 초록이 따라온다고 읽습니다.
          */}
          {initialCaptionNote && (
            <div className="mt-2 space-y-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2" data-testid="photo-card-source-note">
              <p className="text-xs text-slate-300">출처 · {initialCaptionNote}</p>
              <p className="text-xs text-slate-500">캡션에 이 줄을 같이 넣어 주세요. 여기서 문장을 고치시면 원문 대조는 다시 하셔야 합니다.</p>
            </div>
          )}

          {/* 🔴 「길이」가 아니라 **「한 장당 길이」**입니다. 사진이 여럿이 되면서 이 값은 완성 길이가 아니게
              됐는데, 이름이 그대로면 사람은 이걸 전체 길이로 읽습니다. 전체는 위의 한 줄이 말합니다. */}
          <label className="block text-sm text-slate-300">
            한 장당 길이
            <select
              data-testid="photo-card-seconds"
              className={field}
              value={seconds}
              disabled={pending}
              onChange={(event) => setSeconds(Number(event.target.value) as PhotoCardDurationSeconds)}
            >
              {PHOTO_CARD_DURATIONS.map((value) => <option key={value} value={value}>{value}초</option>)}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            화면 비율
            <select
              data-testid="photo-card-aspect"
              className={field}
              value={aspectRatio}
              disabled={pending}
              onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}
            >
              <option value="9:16">세로 (9:16)</option>
              <option value="16:9">가로 (16:9)</option>
              <option value="1:1">정사각형 (1:1)</option>
              <option value="4:5">세로형 (4:5)</option>
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
          <p className="text-xs text-slate-500">글자, 숫자, '_', '-'만 쓸 수 있습니다. 한글도 됩니다. 나중에 이 이름으로 찾습니다.</p>
          {trimmedId.length > 0 && !SAFE_NAME.test(trimmedId) && (
            <p data-testid="photo-card-id-invalid" className="text-xs text-rose-400">
              괄호·공백·문장부호는 이름에 쓸 수 없습니다. 예: 명언_불광불급
            </p>
          )}
          {nameTaken && (
            <p data-testid="photo-card-id-taken" className="text-xs text-rose-400">
              이 이름은 이미 있습니다. 다시 만들 필요 없이{" "}
              <button type="button" data-testid="photo-card-open-taken" className="underline underline-offset-2 hover:text-rose-300" onClick={() => onOpenCard(trimmedId)}>
                그 카드를 열면
              </button>{" "}
              됩니다.
            </p>
          )}
        </section>

        {/* Said here rather than discovered two screens later. Music is not part of making the card — it is
            chosen at merge time, together with the credit line that some tracks require, and that is the one
            moment where being told about attribution actually changes what a person does. */}
        {/* Repeated next to the button, not only in the header. The header sentence is read once on the way in;
            this one is read at the moment someone hesitates over a button that might cost money. */}
        <p className="text-sm text-slate-400" data-testid="photo-card-music-note">
          <span className="font-semibold text-slate-100">이 단계는 비용이 들지 않습니다</span> — 이미 만들어 둔 그림을 그대로 쓰고
          AI에 새로 요청하지 않습니다. 음악은 다음 단계(영상 합치기)에서 고릅니다. 저작권 표시가 필요한 음원이면 거기서 알려드립니다.
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
