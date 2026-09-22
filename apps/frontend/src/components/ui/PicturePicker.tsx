import { useState } from "react";
import type { Asset } from "@ai-animation-studio/shared";

import { Spinner } from "../Spinner.js";
import { cardSectionRoomy as cardSection } from "./surfaces.js";

/**
 * 보관함에서 그림을 **순서대로** 고르는 칸.
 *
 * 🔴 **명언 카드 화면에서 옮겨 온 것이고, 동작은 한 글자도 안 바뀌었습니다.** 뉴스 릴도 같은 고르개를 써야 하는데
 * (docs/06_DECISIONS.md D-052 가 계약을 가른 대로 화면도 갈립니다), 격자를 한 벌 더 만들면 **같은 것이 두 군데**가 됩니다 —
 * 이 저장소가 계속 잡아 온 그 모양입니다.
 *
 * 🟠 `testIdPrefix` 의 기본값이 `photo-card` 인 것은 **기존 짝이 그 이름을 보고 있어서**입니다. 옮기는 커밋이
 * 이름까지 바꾸면 「동작 변화 없음」을 짝이 증명해 줄 수 없습니다.
 */
export interface PicturePickerError {
  code: string;
  message: string;
}

interface PicturePickerProps {
  /** 아직 못 읽었으면 `null` — 「없음」(빈 배열)과 다릅니다. */
  assets: Asset[] | null;
  listError: PicturePickerError | null;
  /** 고른 순서가 곧 장면 순서라 배열입니다(`Set` 이면 순서가 우연이 됩니다). */
  assetIds: string[];
  onToggle: (assetId: string) => void;
  max: number;
  /** 한 장을 몇 초 붙드는지 — 「몇 장 × 몇 초 = 몇 초」를 말하려고 받습니다. */
  seconds: number;
  disabled?: boolean;
  testIdPrefix?: string;
  /**
   * 보관함의 폴더들. 주면 격자 위에 **주제 고르개**가 생기고, 안 주면 지금 그대로입니다.
   *
   * 🔴 캡틴D, 2026-09-22: *「난 이 기사가 어떤 내용의 기사인 줄도 몰라서 스포츠를 넣어야 할지 주식인지
   * 국회인지 몰라」* — 125장이 한 줄로 쏟아지면 주제를 정해도 그 주제의 그림을 찾는 게 다시 일입니다.
   * 🟠 **없으면 안 그립니다.** 명언 카드는 폴더를 안 넘기니 그 화면은 한 글자도 안 바뀝니다.
   * 🟠 **넘기는 쪽이 골라서 넘깁니다** — 이 칸은 받은 것을 다 그립니다.
   */
  folders?: { assetId: string; displayName: string }[];
}

/** 폴더 단추가 고르는 값 — `null` 은 「전체」, `""` 는 「폴더 없음」. */
type FolderFilter = string | null;

export function PicturePicker({
  assets,
  listError,
  assetIds,
  onToggle,
  max,
  seconds,
  disabled = false,
  testIdPrefix = "photo-card",
  folders,
}: PicturePickerProps) {
  const atLimit = assetIds.length >= max;
  const totalSeconds = assetIds.length * seconds;

  const [folderFilter, setFolderFilter] = useState<FolderFilter>(null);
  /* 🟠 **그림이 실제로 들어 있는 폴더만** 줄이 됩니다 — 빈 폴더 줄은 고르면 빈 격자가 나오는 줄입니다. */
  const countByFolder = new Map<string, number>();
  for (const asset of assets ?? []) countByFolder.set(asset.parentFolderId, (countByFolder.get(asset.parentFolderId) ?? 0) + 1);
  const folderButtons = (folders ?? []).filter((folder) => (countByFolder.get(folder.assetId) ?? 0) > 0);
  const looseCount = countByFolder.get("") ?? 0;
  const showFolders = folderButtons.length > 0;
  const shown = !showFolders || folderFilter === null
    ? assets
    : (assets ?? []).filter((asset) => asset.parentFolderId === folderFilter);
  /* 🔴 걸러도 **고른 것은 그대로 골라져 있습니다** — 격자에서 안 보일 뿐입니다. 안 보이는 채로 두면
     「분명히 3장 골랐는데 격자에 하나밖에 없다」가 되므로, 몇 장이 숨었는지 아래에서 말합니다. */
  /* 🟠 **거르고 있을 때만 셉니다.** 안 거를 때 이 수는 「아직 목록을 못 읽었다」를 뜻하게 되고, 그건 주제
     때문에 숨은 것이 아닙니다 — 명언 카드처럼 폴더를 안 넘기는 화면에 엉뚱한 경고가 뜹니다. */
  const hiddenPicked = showFolders && folderFilter !== null
    ? assetIds.filter((id) => !(shown ?? []).some((asset) => asset.assetId === id)).length
    : 0;

  return (
    <section aria-label="그림 고르기" className={cardSection}>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-100">
        <span aria-hidden="true" className="h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400" />
        그림 고르기
      </h2>
      {!assets && !listError && <Spinner label="보관함을 불러오는 중..." />}
      {listError && (
        <p role="alert" data-testid={`${testIdPrefix}-list-error`} data-error-code={listError.code} className="text-sm text-rose-400">
          {listError.message}
        </p>
      )}
      {assets && assets.length === 0 && (
        <p data-testid={`${testIdPrefix}-empty`} className="text-sm text-slate-400">
          보관함에 쓸 수 있는 그림이 없습니다. 이미지 보관함에서 먼저 등록해 주세요.
        </p>
      )}
      {/*
        * 🔴 캡틴D, 2026-09-22: *「폴더 보기가 너무 힘들어」* — 단추를 늘어놓으니 **여섯 줄**이 됐습니다.
        * 고르개 **한 줄**이면 폴더가 몇 개든 높이가 안 변합니다. 🟠 장수를 같이 적는 이유: 「경제」가 2장인지
        * 20장인지 모르고 고르면, 고른 뒤에야 빈 격자를 봅니다.
        */}
      {assets && assets.length > 0 && showFolders && (
        <label className="block text-xs text-slate-400">
          주제
          <select
            data-testid={`${testIdPrefix}-folder`}
            className="mt-1 block w-full rounded-xl border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            value={folderFilter ?? "__all__"}
            onChange={(event) => setFolderFilter(event.target.value === "__all__" ? null : event.target.value)}
          >
            <option value="__all__">전체 ({assets.length}장)</option>
            {folderButtons.map((folder) => (
              <option key={folder.assetId} value={folder.assetId}>
                {folder.displayName} ({countByFolder.get(folder.assetId) ?? 0}장)
              </option>
            ))}
            {looseCount > 0 && <option value="">폴더 없음 ({looseCount}장)</option>}
          </select>
        </label>
      )}
      {assets && assets.length > 0 && (
        <ul aria-label="그림 목록" className="grid max-h-[420px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
          {(shown ?? []).map((asset) => {
            const order = assetIds.indexOf(asset.assetId);
            const picked = order >= 0;
            // 🔴 이미 고른 것은 상한과 무관하게 계속 누를 수 있습니다 — 그 누름은 「빼기」입니다.
            const closed = disabled || (!picked && atLimit);
            return (
              <li key={asset.assetId}>
                <button
                  type="button"
                  data-testid={`${testIdPrefix}-asset-${asset.assetId}`}
                  data-pick-order={picked ? order + 1 : undefined}
                  aria-pressed={picked}
                  disabled={closed}
                  className={`relative w-full space-y-1 rounded-xl border p-1.5 text-left disabled:opacity-40 ${picked ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 hover:bg-white/5"}`}
                  onClick={() => onToggle(asset.assetId)}
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
                      data-testid={`${testIdPrefix}-order-${asset.assetId}`}
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
        * 🟠 이 두 줄이 이 칸에서 **고른 결과를 말하는 유일한 자리**입니다. 그림 격자는 무엇을 골랐는지만
        * 보여 주지, 그게 무엇이 되는지는 말하지 않습니다.
        */}
      {hiddenPicked > 0 && (
        <p className="text-xs text-amber-300" data-testid={`${testIdPrefix}-folder-hidden`}>
          고른 그림 중 {hiddenPicked}장은 다른 주제라 지금 안 보입니다 — 빼시려면 「전체」를 눌러 주세요.
        </p>
      )}
      <p className="text-xs text-slate-400 tabular-nums" data-testid={`${testIdPrefix}-length`}>
        {assetIds.length === 0
          ? "아직 고른 그림이 없습니다. 고른 순서대로 한 장씩 이어 붙습니다."
          : `사진 ${assetIds.length}장 × 한 장당 ${seconds}초 = ${totalSeconds}초`}
      </p>
      {atLimit && (
        /* 🔴 「더 못 고른다」만 말하면 사람은 화면이 고장 난 줄 압니다. 왜 닫혔는지와 **어떻게 여는지**를
           같이 말합니다 — 여는 방법은 고른 것을 다시 눌러 빼는 것입니다. */
        <p className="text-xs text-amber-300" data-testid={`${testIdPrefix}-limit`}>
          한 카드에 {max}장까지입니다. 다른 그림을 넣으시려면 고른 것을 다시 눌러 빼 주세요.
        </p>
      )}
    </section>
  );
}
