import { useEffect, useState } from "react";
import type { InstagramPublishTarget, Project, VideoLibraryProjectSummary } from "@ai-animation-studio/shared";

import { getProject, getProjectSettings, toDisplayError } from "../api/projectsApi.js";
import { publishToInstagram, toInstagramPublishDisplayError } from "../api/instagramPublishApi.js";
import { getInstagramTargets, setInstagramTarget, targetLabel, toInstagramTargetsDisplayError } from "../api/instagramTargetsApi.js";
import { getPostDraft, putPostDraft, toPostDraftDisplayError } from "../api/postDraftApi.js";
import { getVideoLibrary, toVideoLibraryDisplayError } from "../api/videoLibraryApi.js";
import { finalVideoContentUrl } from "../api/videoMergeApi.js";
import { hasElectronBridge, openProjectPathInExplorer } from "../api/electronBridge.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";

interface Props {
  onBack: () => void;
}

type DisplayError = { code: string; message: string };
type ListState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; projects: VideoLibraryProjectSummary[] };
/**
 * Where a post would go. Kept apart from the credential settings on purpose — a credential answers "can we act
 * at all?", this answers "where does it land?", and that has to be readable at the moment of publishing rather
 * than two screens away in settings (docs/06_DECISIONS.md D-006).
 */
type TargetsState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; targets: InstagramPublishTarget[]; selectedIgUserId?: string };

type PickedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; project: Project; plannedSeconds: number | null };

/**
 * Instagram's own published limits, not house rules — a caption over this is rejected at post time and a
 * reel over the duration cannot be uploaded as a reel at all. Checking them here means finding out before the
 * file is carried to another app, not after.
 */
const CAPTION_MAX = 2200;
const HASHTAG_MAX = 30;
const REEL_MAX_SECONDS = 180;

const FINAL_VIDEO_PATH = "videos/final/instagram_reel.mp4";

const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";
const fieldClass =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

/** `#` is optional in what the person types — they are listing topics, not writing markup. */
function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/u)
    .map((token) => token.replace(/^#+/u, "").trim())
    .filter((token) => token.length > 0)
    .map((token) => `#${token}`);
}

function dateOnly(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ko-KR");
}

function durationLabel(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Everything that goes in the caption box, in the order it will be read. Built in one place so the character
 * count below is counting the same string the copy button hands over — a count that drifts from what is
 * actually copied is worse than no count.
 */
function composeCaption(parts: { body: string; attribution: string; aiNotice: string; hashtags: string[] }): string {
  const blocks = [
    parts.body.trim(),
    parts.attribution.trim(),
    parts.aiNotice.trim(),
    parts.hashtags.join(" "),
  ].filter((block) => block.length > 0);
  return blocks.join("\n\n");
}

/**
 * Everything that has to happen before a finished video becomes a post, except the posting itself.
 *
 * The publishing step needs a Creator account and Meta's Content Publishing API, and is deliberately not here
 * (docs/06_DECISIONS.md D-012). Everything before it — which video, what the caption says, whether the shape
 * and length are within what a reel accepts, and the credit line the audio licence requires — does not, and
 * that part is what the user is otherwise doing by hand each time.
 */
export function InstagramPostScreen({ onBack }: Props) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [projectId, setProjectId] = useState("");
  const [picked, setPicked] = useState<PickedState>({ status: "idle" });
  const [body, setBody] = useState("");
  const [hashtagsRaw, setHashtagsRaw] = useState("");
  const [aiNoticeOn, setAiNoticeOn] = useState(true);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<DisplayError | null>(null);
  const [targets, setTargets] = useState<TargetsState>({ status: "loading" });
  const [targetPending, setTargetPending] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<DisplayError | null>(null);
  const [openPending, setOpenPending] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  function loadList(): void {
    setList({ status: "loading" });
    getVideoLibrary()
      // Only a project with a merged result can become a post; the rest would be a dead choice.
      .then((response) => setList({ status: "ready", projects: response.projects.filter((p) => p.finalVideoAvailable) }))
      .catch((caught: unknown) => setList({ status: "error", error: toVideoLibraryDisplayError(caught) }));
  }

  function loadTargets(): void {
    setTargets({ status: "loading" });
    getInstagramTargets()
      .then((response) => setTargets({ status: "ready", targets: response.targets, selectedIgUserId: response.selectedIgUserId }))
      .catch((caught: unknown) => setTargets({ status: "error", error: toInstagramTargetsDisplayError(caught) }));
  }

  useEffect(() => {
    loadList();
    loadTargets();
  }, []);

  async function chooseTarget(igUserId: string): Promise<void> {
    if (targetPending || !igUserId) return;
    setTargetPending(true);
    try {
      const response = await setInstagramTarget(igUserId);
      setTargets({ status: "ready", targets: response.targets, selectedIgUserId: response.selectedIgUserId });
    } catch (caught) {
      setTargets({ status: "error", error: toInstagramTargetsDisplayError(caught) });
    } finally {
      setTargetPending(false);
    }
  }

  useEffect(() => {
    if (!projectId) {
      setPicked({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPicked({ status: "loading" });
    setCopied("idle");
    // The project itself carries usedAudio (the credit line, copied by value at merge time); the settings carry
    // the planned length; the draft carries whatever was typed last time. Only the project is essential — the
    // other two degrade to "unknown length" and "blank caption" rather than failing the whole screen.
    Promise.all([
      getProject(projectId),
      getProjectSettings(projectId).catch(() => null),
      getPostDraft(projectId).catch(() => null),
    ])
      .then(([projectResponse, settingsResponse, draft]) => {
        if (cancelled) return;
        setBody(draft?.body ?? "");
        setHashtagsRaw(draft?.hashtags ?? "");
        setAiNoticeOn(draft?.aiNotice ?? true);
        setSaveState("idle");
        setSaveError(null);
        setPicked({
          status: "ready",
          project: projectResponse.project,
          plannedSeconds: settingsResponse?.settings.durationSeconds ?? null,
        });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setPicked({ status: "error", error: toDisplayError(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * Saves on blur rather than on a button, and rather than on every keystroke.
   *
   * A save button is a button people forget, and the whole reason this draft exists is that a caption was being
   * lost by walking away from the screen — leaving on any real navigation blurs the field first. Per-keystroke
   * saving would put a request behind every character for no benefit the person can see.
   *
   * Sends the whole draft every time because the endpoint replaces rather than merges: an omitted field is a
   * deleted field, so a partial save would quietly erase the other two.
   */
  async function saveDraft(next: { body?: string; hashtags?: string; aiNotice?: boolean } = {}): Promise<void> {
    if (!projectId) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await putPostDraft(projectId, {
        body: next.body ?? body,
        hashtags: next.hashtags ?? hashtagsRaw,
        aiNotice: next.aiNotice ?? aiNoticeOn,
      });
      setSaveState("saved");
    } catch (caught) {
      // The text is still in the box, so a failed save is a warning, not a loss — never a reason to block the
      // copy button, which is the one action that actually gets the caption out of here.
      setSaveState("idle");
      setSaveError(toPostDraftDisplayError(caught));
    }
  }

  async function openInExplorer(): Promise<void> {
    if (openPending || !projectId) return;
    setOpenPending(true);
    setOpenFailed(false);
    try {
      const outcome = await openProjectPathInExplorer(projectId, FINAL_VIDEO_PATH);
      if (!outcome?.opened) setOpenFailed(true);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpenPending(false);
    }
  }

  const selectedTarget = targets.status === "ready"
    ? targets.targets.find((target) => target.igUserId === targets.selectedIgUserId) ?? null
    : null;
  const selectedLabel = selectedTarget ? targetLabel(selectedTarget) : null;

  const project = picked.status === "ready" ? picked.project : null;
  const usedAudio = project?.usedAudio;
  const creditRequired = usedAudio?.attributionRequired === true;
  const creditText = usedAudio?.attributionText?.trim() ?? "";
  // Required but blank is a real state: attributionText is optional in the contract, and the app must not
  // invent wording a licence may be specific about.
  const creditMissing = creditRequired && !creditText;

  const hashtags = parseHashtags(hashtagsRaw);
  const aiNotice = aiNoticeOn ? "AI로 만든 영상입니다." : "";
  const caption = composeCaption({ body, attribution: creditRequired ? creditText : "", aiNotice, hashtags });

  const captionOver = caption.length > CAPTION_MAX;
  const hashtagsOver = hashtags.length > HASHTAG_MAX;
  const plannedSeconds = picked.status === "ready" ? picked.plannedSeconds : null;
  const tooLong = plannedSeconds !== null && plannedSeconds > REEL_MAX_SECONDS;
  const notVertical = project?.aspectRatio === "16:9";
  const copyBlocked = captionOver || hashtagsOver || creditMissing;
  const published = project?.instagramPost;
  // Pressing and being refused is worse than not being able to press: the reasons are all knowable here
  // (no account chosen, caption over the limit, credit line missing, already out in the world).
  const publishBlocked = copyBlocked || !caption || !selectedTarget || Boolean(published);

  /**
   * The one irreversible, public action in this app. Reached only from a panel that named the account, and the
   * account it names travels with the request so the two provably match.
   */
  async function publish(): Promise<void> {
    if (publishing || !projectId || !selectedTarget) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const response = await publishToInstagram(projectId, caption, selectedTarget.igUserId);
      setConfirmPublish(false);
      // The response carries the project with instagramPost set, so the screen switches to "already published"
      // from the server's own record rather than from a local flag that a refresh would forget.
      setPicked((current) => (current.status === "ready" ? { ...current, project: response.project } : current));
    } catch (caught) {
      setPublishError(toInstagramPublishDisplayError(caught));
    } finally {
      setPublishing(false);
    }
  }

  async function copyCaption(): Promise<void> {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        게시물 준비
      </h1>
      {/* Said once, plainly, at the top: this screen never reaches Instagram. Nothing else on it would tell a
          person that, and "prepare" is a word that could mean either. */}
      <p className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300" data-testid="post-scope-notice">
        올릴 영상을 고르고 캡션을 만든 뒤, 여기서 바로 올릴 수 있습니다. 올리기 전에 어느 계정으로 나가는지 한 번 더 확인합니다.
        캡션만 복사해서 인스타그램 앱에서 직접 올리셔도 됩니다.
      </p>
      <p className="text-sm text-slate-400" data-testid="post-draft-notice">
        쓰던 캡션은 프로젝트별로 저장돼서, 다음에 들어오면 그대로 이어서 쓸 수 있습니다.
      </p>

      {list.status === "loading" && <Spinner label="영상 목록을 불러오는 중..." />}
      {list.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="post-list-error" data-error-code={list.error.code} className="text-sm text-rose-400">
            {list.error.message}
          </p>
          <button type="button" className={outlineButton} onClick={loadList}>
            다시 시도
          </button>
        </div>
      )}

      {list.status === "ready" && !list.projects.length && (
        <p data-testid="post-empty" className="text-sm text-slate-400">
          아직 합쳐 둔 최종 영상이 없습니다. 프로젝트에서 영상을 합치면 여기에서 고를 수 있습니다.
        </p>
      )}

      {list.status === "ready" && Boolean(list.projects.length) && (
        <label className="block text-sm text-slate-300" htmlFor="post-project">
          올릴 영상
          <select
            id="post-project"
            data-testid="post-project"
            className={fieldClass}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">고르지 않음</option>
            {list.projects.map((candidate) => (
              <option key={candidate.projectId} value={candidate.projectId}>
                {candidate.topic || candidate.projectId}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Where it goes, shown next to what goes — not buried in settings. Even with a single account this stays
          on screen: not asking and not showing are different things, and the day a second account appears is
          exactly the day a wrong destination costs something that cannot be taken back. */}
      <div className={cardSection} data-testid="post-target">
        <p className="text-sm font-semibold text-slate-200">올릴 계정</p>

        {targets.status === "loading" && <Spinner label="계정을 불러오는 중..." />}

        {targets.status === "error" && (
          <div className="space-y-2">
            <p role="alert" data-testid="post-target-error" data-error-code={targets.error.code} className="text-sm text-rose-400">
              {targets.error.message}
            </p>
            <button type="button" className={outlineButton} onClick={loadTargets}>
              다시 시도
            </button>
          </div>
        )}

        {/* An empty list is not an error and not "log in" — the account exists but no Facebook Page is linked to
            it, which is a different thing for the user to go fix. */}
        {targets.status === "ready" && !targets.targets.length && (
          <p data-testid="post-target-none" className="text-sm text-slate-400">
            게시할 수 있는 인스타그램 계정이 없습니다. 인스타그램 프로페셔널 계정이 페이스북 페이지에 연결돼 있어야 합니다.
          </p>
        )}

        {targets.status === "ready" && Boolean(targets.targets.length) && (
          <>
            <label className="sr-only" htmlFor="post-target-select">올릴 계정 고르기</label>
            <select
              id="post-target-select"
              data-testid="post-target-select"
              className={fieldClass}
              value={targets.selectedIgUserId ?? ""}
              disabled={targetPending}
              onChange={(event) => void chooseTarget(event.target.value)}
            >
              <option value="">고르지 않음</option>
              {targets.targets.map((target) => {
                const label = targetLabel(target);
                return (
                  <option key={target.igUserId} value={target.igUserId}>
                    {label.name}
                    {label.handleUnavailable ? " (핸들을 읽지 못함)" : ""}
                  </option>
                );
              })}
            </select>

            {/* The stored choice was checked against this very list by the server; its absence means the page was
                disconnected, deleted, or lost its permission since. Saying so beats an empty selector. */}
            {!targets.selectedIgUserId && (
              <p data-testid="post-target-unset" className="text-sm text-amber-300">
                전에 고른 계정을 지금은 찾을 수 없습니다. 연결이 끊겼거나 권한이 회수됐을 수 있습니다. 위에서 다시 골라 주세요.
              </p>
            )}

            {selectedTarget && (
              <p data-testid="post-target-selected" className="text-sm text-slate-300">
                이 영상은 <strong className="text-slate-100">{selectedLabel?.name}</strong> 계정으로 올라갑니다.
                {selectedLabel?.handleUnavailable && (
                  <span data-testid="post-target-handle-missing" className="mt-1 block text-xs text-amber-300">
                    이 계정의 @핸들을 읽지 못해 연결된 페이지 이름으로 표시하고 있습니다. 올리기 전에 맞는 계정인지 확인해 주세요.
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </div>

      {picked.status === "loading" && <Spinner label="프로젝트를 불러오는 중..." />}
      {picked.status === "error" && (
        <p role="alert" data-testid="post-project-error" data-error-code={picked.error.code} className="text-sm text-rose-400">
          {picked.error.message}
        </p>
      )}

      {picked.status === "ready" && (
        <>
          <div className={cardSection} data-testid="post-video">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- generated clips carry no caption track */}
            <video
              data-testid="post-video-player"
              className={`${notVertical ? "aspect-video" : "aspect-[9/16]"} w-full max-w-xs rounded-xl border border-white/10 bg-slate-950/60`}
              controls
              preload="none"
              src={finalVideoContentUrl(projectId)}
            />
            <p className="text-sm text-slate-300" data-testid="post-video-path">
              저장 위치: {FINAL_VIDEO_PATH}
            </p>
            {hasElectronBridge() && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid="post-open-in-explorer"
                  className={outlineButton}
                  onClick={() => void openInExplorer()}
                  disabled={openPending}
                >
                  {openPending ? "여는 중..." : "탐색기에서 열기"}
                </button>
                {openFailed && (
                  <p role="alert" data-testid="post-open-failed" className="text-sm text-rose-400">
                    폴더를 열지 못했습니다.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* The three things Instagram itself decides, checked while the file is still on this machine. */}
          <div className={cardSection} data-testid="post-checks">
            <p className="text-sm font-semibold text-slate-200">올리기 전 확인</p>
            <div className="flex flex-wrap items-center gap-2" data-testid="post-check-shape">
              <StatusChip tone={notVertical ? "progress" : "success"}>{notVertical ? "가로 영상" : "세로 9:16"}</StatusChip>
              {notVertical && (
                <span className="text-xs text-slate-400">
                  릴스는 세로가 기본입니다. 올라가긴 하지만 화면에 여백이 생기거나 잘립니다.
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="post-check-length">
              {plannedSeconds === null ? (
                <span className="text-xs text-slate-400">길이를 확인하지 못했습니다.</span>
              ) : (
                <>
                  <StatusChip tone={tooLong ? "danger" : "success"}>{durationLabel(plannedSeconds)}</StatusChip>
                  <span className="text-xs text-slate-400">
                    {tooLong ? "릴스 한도(3분)를 넘습니다. 장면 수나 장면 길이를 줄여야 합니다." : "릴스 한도(3분) 안입니다."}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className={cardSection}>
            <label className="block text-sm text-slate-300" htmlFor="post-body">
              캡션 본문
              <textarea
                id="post-body"
                data-testid="post-body"
                rows={6}
                className={fieldClass}
                placeholder="첫 줄이 미리보기에 보입니다."
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onBlur={() => void saveDraft()}
              />
            </label>

            <label className="block text-sm text-slate-300" htmlFor="post-hashtags">
              해시태그
              <input
                id="post-hashtags"
                data-testid="post-hashtags"
                className={fieldClass}
                placeholder="쉼표나 띄어쓰기로 구분 · # 은 안 붙여도 됩니다"
                value={hashtagsRaw}
                onChange={(event) => setHashtagsRaw(event.target.value)}
                onBlur={() => void saveDraft()}
              />
            </label>
            <p className={`text-xs tabular-nums ${hashtagsOver ? "text-rose-400" : "text-slate-400"}`} data-testid="post-hashtag-count">
              해시태그 {hashtags.length}/{HASHTAG_MAX}
              {hashtagsOver && " — 인스타그램이 받아주는 한도를 넘었습니다."}
            </p>
            {saveState === "saving" && <p data-testid="post-draft-saving" className="text-xs text-slate-400">저장 중...</p>}
            {saveState === "saved" && <p data-testid="post-draft-saved" className="text-xs text-emerald-400">저장했습니다.</p>}
            {saveError && (
              <p role="alert" data-testid="post-draft-error" data-error-code={saveError.code} className="text-xs text-rose-400">
                {saveError.message} 쓰던 캡션은 화면에 그대로 있으니 복사해 두세요.
              </p>
            )}

            <label className="flex items-start gap-2 text-sm text-slate-300" htmlFor="post-ai-notice">
              <input
                id="post-ai-notice"
                data-testid="post-ai-notice"
                type="checkbox"
                className="mt-1"
                checked={aiNoticeOn}
                onChange={(event) => {
                  setAiNoticeOn(event.target.checked);
                  // A checkbox has no meaningful blur of its own — the click is the whole interaction.
                  void saveDraft({ aiNotice: event.target.checked });
                }}
              />
              <span>
                캡션에 AI 생성 고지 넣기
                <span className="block text-xs text-slate-500">
                  인스타그램 자체의 AI 라벨은 이것과 별개입니다 — 올릴 때 그쪽도 켜 주세요.
                </span>
              </span>
            </label>

            {/* Not editable and not optional: the licence requires this exact sentence to appear where the work
                is published, and letting it be edited here is how it quietly stops matching. */}
            {creditRequired && !creditMissing && (
              <div data-testid="post-credit" className="space-y-1 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
                <p className="text-xs font-semibold text-amber-300">이 음원은 출처 표시가 필요해 캡션에 자동으로 들어갑니다.</p>
                <p className="text-sm text-slate-200">{creditText}</p>
              </div>
            )}
            {creditMissing && (
              <p role="alert" data-testid="post-credit-missing" className="text-sm text-rose-400">
                이 영상에 쓴 음원은 출처 표시가 필요한데 적을 문구가 비어 있습니다. 음원 보관함에서 문구를 채운 뒤 다시 오세요.
              </p>
            )}
          </div>

          <div className={cardSection}>
            <p className="text-sm font-semibold text-slate-200">완성된 캡션</p>
            <p
              data-testid="post-caption-preview"
              className="select-all whitespace-pre-wrap rounded-xl bg-slate-950/60 px-3.5 py-3 text-sm text-slate-200"
            >
              {caption || "아직 아무것도 없습니다."}
            </p>
            <p className={`text-xs tabular-nums ${captionOver ? "text-rose-400" : "text-slate-400"}`} data-testid="post-caption-count">
              {caption.length}/{CAPTION_MAX}자
              {captionOver && " — 인스타그램이 받아주는 한도를 넘었습니다."}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="post-copy"
                className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                onClick={() => void copyCaption()}
                disabled={copyBlocked || !caption}
              >
                캡션 복사
              </button>
              {copied === "done" && <span data-testid="post-copied" className="text-xs text-emerald-400">복사했습니다.</span>}
              {copied === "failed" && (
                <span data-testid="post-copy-failed" className="text-xs text-slate-400">
                  복사하지 못했습니다. 위 캡션을 직접 선택해 복사해 주세요.
                </span>
              )}
            </div>
          </div>

          <div className={cardSection} data-testid="post-publish">
            {published ? (
              // Already out in the world. The button is gone rather than disabled: there is no state of this
              // screen in which pressing it again is something the person wants.
              <>
                <p className="text-sm font-semibold text-emerald-400" data-testid="post-published">
                  이미 게시했습니다 · {dateOnly(published.publishedAt)}
                </p>
                <p className="text-xs text-slate-400">
                  같은 영상을 또 올리면 계정에 같은 게시물이 두 개가 됩니다. 새로 올리려면 새 영상을 만들어 주세요.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-200">인스타그램에 올리기</p>

                {!confirmPublish && (
                  <button
                    type="button"
                    data-testid="post-publish-button"
                    className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                    disabled={publishBlocked || publishing}
                    onClick={() => {
                      setPublishError(null);
                      setConfirmPublish(true);
                    }}
                  >
                    올리기
                  </button>
                )}

                {!selectedTarget && !published && (
                  <p data-testid="post-publish-needs-target" className="text-xs text-amber-300">
                    올릴 계정을 먼저 골라 주세요.
                  </p>
                )}

                {confirmPublish && selectedLabel && (
                  <div
                    role="alertdialog"
                    aria-label="인스타그램 게시 확인"
                    data-testid="post-publish-confirm"
                    className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
                  >
                    {/* The account is named here, always — including when there is only one. A mistaken charge
                        can be argued about afterwards; a mistaken post cannot be unseen by whoever saw it. */}
                    <p className="text-sm font-semibold text-amber-300">
                      <span data-testid="post-publish-confirm-account">{selectedLabel.name}</span> 계정에 이 영상을 게시합니다.
                    </p>
                    <p className="text-sm text-slate-300">
                      게시하면 되돌릴 수 없습니다. 지운다고 해도 이미 본 사람에게서는 사라지지 않습니다.
                      {selectedLabel.handleUnavailable && " 이 계정의 @핸들을 읽지 못해 페이지 이름으로 표시하고 있습니다 — 맞는 계정인지 다시 확인해 주세요."}
                    </p>
                    <p className="text-xs text-slate-400">올리는 데 몇 분까지 걸릴 수 있습니다.</p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className={outlineButton}
                        data-testid="post-publish-cancel"
                        disabled={publishing}
                        onClick={() => setConfirmPublish(false)}
                      >
                        돌아가기
                      </button>
                      <button
                        type="button"
                        className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                        data-testid="post-publish-confirm-button"
                        disabled={publishing}
                        onClick={() => void publish()}
                      >
                        {publishing ? "올리는 중입니다..." : "네, 게시합니다"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {publishError && (
              <p
                role="alert"
                data-testid="post-publish-error"
                data-error-code={publishError.code}
                className="text-sm text-rose-400"
              >
                {publishError.message}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
