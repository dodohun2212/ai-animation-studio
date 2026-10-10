import { useEffect, useRef, useState } from "react";
import type { Asset, LongStoryBible } from "@ai-animation-studio/shared";

import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { getLongProjectStoryBible, toLongStoryBibleDisplayError, updateLongStoryBibleSupportingCharacterAssetLinks } from "../api/longStoryBibleApi.js";
import { CollapsibleCard } from "./CollapsibleCard.js";
import { outlineButton } from "./ui/surfaces.js";

interface Props {
  projectId: string;
}

interface SupportingCard { id: string; name: string }
type DisplayError = { code: string; message: string };

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

/** Story Bible `basic.characterCards`(소설 분석으로 만든 작품만 있음)에서 조연만 — 모양이 다른 항목은 건너뜁니다. */
export function supportingCardsOf(bible: LongStoryBible): SupportingCard[] {
  const cards = (bible.basic as Record<string, unknown>).characterCards;
  if (!Array.isArray(cards)) return [];
  return cards.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const card = entry as Record<string, unknown>;
    return card.role === "supporting" && typeof card.id === "string" && typeof card.name === "string" ? [{ id: card.id, name: card.name }] : [];
  });
}

/**
 * 조연 — 소설 분석으로 만든 작품의 조연마다 **보관함 캐릭터 폴더**를 연결합니다(M4).
 *
 * 연결된 폴더는 아직 그림을 만들지 않은 회차의 참고 이미지에 자동으로 들어갑니다. 사람이 회차에서 직접 고른 연결·제외와 이미
 * 그림이 있는 회차는 바뀌지 않습니다(서버 규칙). 저장은 연결 목록을 통째로 바꾸는 요청 하나이고 Provider 를 부르지 않습니다.
 * 직접 설정으로 만든 작품에는 조연 인물 카드가 없어서 그렇다고 말합니다.
 */
export function SupportingCastCard({ projectId }: Props) {
  const [folders, setFolders] = useState<Asset[]>([]);
  const [cast, setCast] = useState<SupportingCard[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const busy = useRef(false);

  function adopt(bible: LongStoryBible): void {
    const next: Record<string, string> = {};
    for (const link of bible.supportingCharacterAssetLinks ?? []) next[link.characterId] = link.assetId;
    setCast(supportingCardsOf(bible));
    setLinks(next);
    setSaved(next);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([listAssets({ assetType: "character" }), getLongProjectStoryBible(projectId)])
      .then(([assetsResult, bibleResult]) => {
        if (cancelled) return;
        if (assetsResult.status === "fulfilled") setFolders(assetsResult.value.assets.filter((asset) => asset.isFolder && asset.assetType === "character" && asset.enabled));
        else setError(toAssetDisplayError(assetsResult.reason));
        if (bibleResult.status === "fulfilled") adopt(bibleResult.value.storyBible);
        else setError(toLongStoryBibleDisplayError(bibleResult.reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const chosen = cast.filter((character) => links[character.id]);
  const duplicate = new Set(chosen.map((character) => links[character.id])).size !== chosen.length;
  const dirty = JSON.stringify(Object.entries(links).filter(([, value]) => value).sort()) !== JSON.stringify(Object.entries(saved).filter(([, value]) => value).sort());

  async function save(): Promise<void> {
    if (busy.current || duplicate) return;
    busy.current = true; setPending(true); setError(null); setSavedNotice(false);
    try {
      const response = await updateLongStoryBibleSupportingCharacterAssetLinks(projectId, {
        links: chosen.map((character) => ({ characterId: character.id, assetId: links[character.id]! })),
      });
      adopt(response.storyBible);
      setSavedNotice(true);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  const linkedCount = Object.values(saved).filter(Boolean).length;

  return (
    <CollapsibleCard title="조연" testId="supporting-cast-card" summary={cast.length === 0 ? "조연 카드 없음" : `${linkedCount}/${cast.length}명 연결`}>
      <p className="text-sm text-slate-400">
        조연마다 이미지 보관함의 캐릭터 폴더를 연결하면, 아직 그림을 만들지 않은 회차의 참고 이미지에 자동으로 들어갑니다. 회차에서 직접 고른 연결·제외와 이미 그림이 있는 회차는 바뀌지 않습니다.
      </p>
      {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
      {!loading && cast.length === 0 && (
        <p data-testid="supporting-cast-none" className="text-sm text-slate-400">
          이 작품에는 조연 인물 카드가 없습니다 — 조연 카드는 「소설에서 시작」에서 AI 분석을 확인·수정해 만든 작품에 생깁니다. 회차마다 「참고 이미지 연결」에서 직접 고를 수 있습니다.
        </p>
      )}
      {!loading && cast.length > 0 && folders.length === 0 && (
        <p data-testid="supporting-cast-no-folders" className="text-sm text-slate-400">쓸 수 있는 캐릭터 폴더가 없습니다 — <strong className="text-slate-300">이미지 보관함</strong>에서 캐릭터 폴더를 만들어 주세요.</p>
      )}
      {!loading && cast.length > 0 && folders.length > 0 && (
        <ul className="space-y-3" data-testid="supporting-cast-list">
          {cast.map((character) => (
            <li key={character.id}>
              <label className="block text-sm text-slate-300">
                {character.name}
                <select
                  aria-label={`${character.name} 캐릭터 폴더`}
                  data-testid={`supporting-cast-select-${character.id}`}
                  value={links[character.id] ?? ""}
                  disabled={pending}
                  onChange={(event) => { setLinks((old) => ({ ...old, [character.id]: event.target.value })); setSavedNotice(false); }}
                  className={fieldClassName}
                >
                  <option value="">연결하지 않음</option>
                  {folders.map((folder) => <option key={folder.assetId} value={folder.assetId}>{folder.displayName} (이미지 {folder.childAssetIds.length}장)</option>)}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
      {duplicate && <p role="status" data-testid="supporting-cast-duplicate" className="text-sm text-amber-300">같은 캐릭터 폴더를 두 조연에 연결할 수 없습니다.</p>}
      {dirty && !duplicate && <p role="status" data-testid="supporting-cast-dirty" className="text-sm text-amber-300">아직 저장하지 않았습니다.</p>}
      {error && <p role="alert" data-testid="supporting-cast-error" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
      {savedNotice && <p data-testid="supporting-cast-saved" className="text-sm text-emerald-400">저장했습니다.</p>}
      {!loading && cast.length > 0 && folders.length > 0 && (
        <button type="button" data-testid="supporting-cast-save" className={outlineButton} onClick={() => void save()} disabled={pending || duplicate || !dirty}>
          {pending ? "저장하는 중..." : "조연 연결 저장"}
        </button>
      )}
    </CollapsibleCard>
  );
}
