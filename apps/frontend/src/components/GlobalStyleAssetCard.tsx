import { useEffect, useRef, useState } from "react";
import type { Asset, LongStoryBibleStyleAssetLink } from "@ai-animation-studio/shared";

import { CollapsibleCard } from "./CollapsibleCard.js";
import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { getLongProjectStoryBible, toLongStoryBibleDisplayError, updateLongStoryBibleStyleAssetLink } from "../api/longStoryBibleApi.js";

interface Props {
  projectId: string;
}

type DisplayError = { code: string; message: string };

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";

/**
 * The one picture that applies to the whole work: its drawing style.
 *
 * It lives here, next to 화면 비율 and the rest of the project-wide choices, rather than on the Story Bible
 * screen where it used to sit. Nothing about it is per-character or per-Episode — the server attaches it as a
 * style reference to every Episode's image work — so it belonged with the other things that are true of the
 * whole project, and on the Story Bible it read as a ninth thing to fill in among eight others.
 *
 * It is stored inside the Story Bible's `basic` record, which is why the calls below still go to that API. That
 * is a storage detail and not a reason for the control to be on that screen.
 */
export function GlobalStyleAssetCard({ projectId }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [versionPolicy, setVersionPolicy] = useState<LongStoryBibleStyleAssetLink["versionPolicy"]>("pinned_version");
  const [linked, setLinked] = useState<LongStoryBibleStyleAssetLink | null>(null);
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
          setAssets(assetsResult.value.assets.filter((asset) => asset.assetType === "style" && !asset.isFolder && asset.enabled && asset.approved));
        } else setError(toAssetDisplayError(assetsResult.reason));
        if (bibleResult.status === "fulfilled") {
          const link = bibleResult.value.storyBible.styleAssetLink ?? null;
          setLinked(link);
          setAssetId(link?.assetId ?? "");
          setVersionPolicy(link?.versionPolicy ?? "pinned_version");
        } else setError(toLongStoryBibleDisplayError(bibleResult.reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  async function save(): Promise<void> {
    if (busy.current) return;
    const asset = assets.find((item) => item.assetId === assetId);
    if (assetId && !asset) { setError({ code: "CLIENT_INVALID_SELECTION", message: "이미지 보관함에서 쓸 수 있는 스타일 항목을 골라 주세요." }); return; }
    busy.current = true; setPending(true); setError(null); setSaved(false);
    try {
      const assetLink = asset ? { assetId: asset.assetId, versionPolicy, pinnedVersion: asset.version } : null;
      const response = await updateLongStoryBibleStyleAssetLink(projectId, { assetLink });
      const link = response.storyBible.styleAssetLink ?? null;
      setLinked(link);
      setAssetId(link?.assetId ?? "");
      setVersionPolicy(link?.versionPolicy ?? "pinned_version");
      setSaved(true);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  return (
    <CollapsibleCard
      title="전체 그림체"
      testId="global-style-card"
      summary={linked ? (assets.find((asset) => asset.assetId === linked.assetId)?.displayName ?? linked.assetId) : "고르지 않음"}
    >
      {/* Says what it does, not what it is. "전체 비주얼 스타일" named a field; this names an effect. */}
      <p className="text-sm text-slate-400">고른 그림 한 장이 <strong className="text-slate-300">모든 회차의 모든 장면</strong>에 같이 전달됩니다.</p>

      {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}

      {!loading && assets.length === 0 ? (
        // An empty dropdown reads as "broken"; the way out is a different screen, so it is named.
        <p data-testid="global-style-none-available" className="text-sm text-slate-400">
          쓸 수 있는 그림체 이미지가 없습니다 — <strong className="text-slate-300">이미지 보관함</strong>에서 유형을 스타일로 등록하고 승인해 주세요.
        </p>
      ) : !loading && (
        <>
          <label className="block text-sm text-slate-300">
            그림체 이미지
            <select
              aria-label="전체 그림체 이미지"
              data-testid="global-style-select"
              value={assetId}
              disabled={pending}
              onChange={(event) => { setAssetId(event.target.value); setSaved(false); }}
              className={fieldClassName}
            >
              <option value="">고르지 않음</option>
              {assets.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>{asset.displayName} · v{asset.version}</option>
              ))}
            </select>
          </label>
          {assetId && (
            <label className="block text-sm text-slate-300">
              이 그림을 나중에 고쳤을 때
              <select
                aria-label="전체 그림체 버전 정책"
                value={versionPolicy}
                disabled={pending}
                onChange={(event) => { setVersionPolicy(event.target.value as LongStoryBibleStyleAssetLink["versionPolicy"]); setSaved(false); }}
                className={fieldClassName}
              >
                <option value="pinned_version">지금 이 버전만 계속 쓰기</option>
                <option value="follow_latest">고친 최신 버전을 따라가기</option>
                <option value="snapshot">지금 이 버전을 복사해 두기</option>
              </select>
            </label>
          )}
        </>
      )}

      {linked && (
        <p data-testid="global-style-asset-link" className="text-sm text-emerald-300">
          지금 쓰는 그림체: {assets.find((asset) => asset.assetId === linked.assetId)?.displayName ?? linked.assetId} · v{linked.pinnedVersion}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="global-style-error" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>
      )}
      {saved && <p data-testid="global-style-saved" className="text-sm text-emerald-400">저장했습니다.</p>}

      {!loading && assets.length > 0 && (
        <button type="button" data-testid="global-style-save" className={outlineButton} onClick={() => void save()} disabled={pending}>
          {pending ? "저장하는 중..." : assetId ? "이 그림체로 저장" : "그림체 빼기"}
        </button>
      )}
    </CollapsibleCard>
  );
}
