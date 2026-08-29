import { useEffect, useRef, useState } from "react";
import type { Asset, LongStoryBibleProtagonistLink } from "@ai-animation-studio/shared";

import { CollapsibleCard } from "./CollapsibleCard.js";
import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { getLongProjectStoryBible, toLongStoryBibleDisplayError, updateLongStoryBibleProtagonistAssetLink } from "../api/longStoryBibleApi.js";

interface Props {
  projectId: string;
}

type DisplayError = { code: string; message: string };

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";

/**
 * The one character the whole work is about.
 *
 * Sits beside 전체 그림체 because it is the same kind of thing: one Asset chosen once for the project rather
 * than re-picked per Episode. Sub-characters and locations stay per-Episode — a work has one protagonist and a
 * different supporting cast each time.
 *
 * What actually leaves this card today is the folder's NAME, read by episode-scripts.service.ts and put in the
 * script prompt. The pictures do not: an Episode's reference images come from its own asset mapping, and
 * nothing seeds that from here. This paragraph used to say the Asset was "applied to every Episode", which is
 * true of the name and was read — reasonably — as true of the pictures too, by the person who then linked the
 * same folder by hand twenty times.
 *
 * That gap is being closed on the server (auto-seeding the mapping from this link, for Episodes that have not
 * generated images yet). When it lands, this note and the sentence under the title both need revisiting — they
 * are written to describe today, not to lower expectations permanently.
 *
 * Folders only, and that is the opposite of the Story Bible's per-item links, which refused folders. A
 * character is the set of angles of one person; a single image is one pose of them. The server enforces the
 * same rule, so a folder chosen here is a folder the server accepts — the deadlock the Story Bible had (the
 * screen offering only folders and the server refusing every one) cannot happen on this path.
 *
 * `approved` is deliberately not required: folders are created unapproved and the server has no way to flip
 * that flag, so asking for it would hide every folder forever.
 */
export function ProtagonistAssetCard({ projectId }: Props) {
  const [folders, setFolders] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [versionPolicy, setVersionPolicy] = useState<LongStoryBibleProtagonistLink["versionPolicy"]>("follow_latest");
  const [linked, setLinked] = useState<LongStoryBibleProtagonistLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([listAssets({}), getLongProjectStoryBible(projectId)])
      .then(([assetsResult, bibleResult]) => {
        if (cancelled) return;
        if (assetsResult.status === "fulfilled") {
          setFolders(assetsResult.value.assets.filter((asset) => asset.isFolder && asset.assetType === "character" && asset.enabled));
        } else setError(toAssetDisplayError(assetsResult.reason));
        if (bibleResult.status === "fulfilled") {
          const link = bibleResult.value.storyBible.protagonistAssetLink ?? null;
          setLinked(link);
          setAssetId(link?.assetId ?? "");
          setVersionPolicy(link?.versionPolicy ?? "follow_latest");
        } else setError(toLongStoryBibleDisplayError(bibleResult.reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  async function save(): Promise<void> {
    if (busy.current) return;
    const folder = folders.find((item) => item.assetId === assetId);
    if (assetId && !folder) { setError({ code: "CLIENT_INVALID_SELECTION", message: "이미지 보관함에서 쓸 수 있는 캐릭터 폴더를 골라 주세요." }); return; }
    busy.current = true; setPending(true); setError(null); setSaved(false);
    try {
      // A folder has no version of its own — its children carry those — so a pinned number would be pinning
      // nothing. The server accepts null for exactly that reason.
      const assetLink = folder ? { assetId: folder.assetId, versionPolicy, pinnedVersion: null } : null;
      const response = await updateLongStoryBibleProtagonistAssetLink(projectId, { assetLink });
      const link = response.storyBible.protagonistAssetLink ?? null;
      setLinked(link);
      setAssetId(link?.assetId ?? "");
      setVersionPolicy(link?.versionPolicy ?? "follow_latest");
      setSaved(true);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  const linkedFolder = linked ? folders.find((folder) => folder.assetId === linked.assetId) : undefined;

  return (
    <CollapsibleCard
      title="주인공"
      testId="protagonist-card"
      summary={linked ? (linkedFolder?.displayName ?? linked.assetId) : "고르지 않음"}
    >
      <p className="text-sm text-slate-400">폴더 이름이 곧 주인공 이름입니다 — 보관함에서 고치면 다음 대본부터 반영됩니다. 서브 캐릭터는 회차마다 따로 고릅니다.</p>
      {/* Said plainly because the absence is invisible: nothing on the Episode's mapping screen shows that a
          protagonist was ever chosen here, so a person who set one reasonably assumes it is being used. */}
      <p data-testid="protagonist-scope-notice" className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
        지금은 <strong className="text-amber-200">이름만</strong> 대본에 실립니다. 그림을 쓰려면 회차마다 <strong className="text-amber-200">참고 이미지 연결</strong>에서 이 폴더를 직접 골라 주세요.
      </p>

      {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}

      {!loading && folders.length === 0 ? (
        // The way out is on another screen, so the card names that screen and what to make there. A dropdown
        // with nothing in it and a save button beside it reads as broken.
        <p data-testid="protagonist-none-available" className="text-sm text-slate-400">
          쓸 수 있는 캐릭터 폴더가 없습니다 — <strong className="text-slate-300">이미지 보관함</strong>에서 캐릭터 폴더를 만들어 주세요.
        </p>
      ) : !loading && (
        <>
          <label className="block text-sm text-slate-300">
            캐릭터 폴더
            <select
              aria-label="주인공 캐릭터 폴더"
              data-testid="protagonist-select"
              value={assetId}
              disabled={pending}
              onChange={(event) => { setAssetId(event.target.value); setSaved(false); }}
              className={fieldClassName}
            >
              <option value="">고르지 않음</option>
              {folders.map((folder) => (
                <option key={folder.assetId} value={folder.assetId}>
                  {folder.displayName} (이미지 {folder.childAssetIds.length}장)
                </option>
              ))}
            </select>
            {/* The name is not copied at save time — it is read when the script is written — so renaming the
                folder is how you rename the protagonist. Said in one clause rather than three sentences. */}
            <span className="mt-1 block text-xs text-slate-500">이름은 이미지 보관함에서 폴더 이름을 고치면 바뀝니다.</span>
          </label>
          {assetId && (
            <label className="block text-sm text-slate-300">
              폴더에 그림을 더 넣었을 때
              <select
                aria-label="주인공 버전 정책"
                value={versionPolicy}
                disabled={pending}
                onChange={(event) => { setVersionPolicy(event.target.value as LongStoryBibleProtagonistLink["versionPolicy"]); setSaved(false); }}
                className={fieldClassName}
              >
                <option value="follow_latest">새로 넣은 것까지 같이 쓰기</option>
                <option value="pinned_version">지금 상태 그대로 쓰기</option>
              </select>
            </label>
          )}
        </>
      )}

      {linked && (
        <p data-testid="protagonist-linked" className="text-sm text-emerald-300">
          지금 주인공: {linkedFolder?.displayName ?? linked.assetId}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="protagonist-error" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>
      )}
      {saved && <p data-testid="protagonist-saved" className="text-sm text-emerald-400">저장했습니다.</p>}

      {!loading && folders.length > 0 && (
        <button type="button" data-testid="protagonist-save" className={outlineButton} onClick={() => void save()} disabled={pending}>
          {pending ? "저장하는 중..." : assetId ? "이 캐릭터를 주인공으로" : "주인공 빼기"}
        </button>
      )}
    </CollapsibleCard>
  );
}
