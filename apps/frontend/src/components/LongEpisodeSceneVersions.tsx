import { useEffect, useState } from "react";
import type { LongEpisodeDetail, SceneNumber, VideoVersionSummary } from "@ai-animation-studio/shared";

import { listLongEpisodeVideoVersions, longEpisodeVideoVersionContentUrl, restoreLongEpisodeVideoVersion, toLongProjectDisplayError } from "../api/longProjectsApi.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  sceneNumber: SceneNumber;
  onRestored: (episode: LongEpisodeDetail) => void;
}

/** Bytes as something a person reads, since "이 판이 더 크다" is a real reason to pick one. */
function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function dateLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * The clips this scene has had, collapsed until asked for.
 *
 * Regenerating a scene has always archived the clip it replaced, but nothing read that directory — money was
 * spent on clips that stayed on disk with no way back to them. This is the way back.
 *
 * Renders nothing at all when there is only `current`: a scene never regenerated has no history, and a
 * disclosure that opens onto one row is noise on a screen already asked to say less.
 */
export function LongEpisodeSceneVersions({ projectId, episodeNumber, sceneNumber, onRestored }: Props) {
  const [versions, setVersions] = useState<readonly VideoVersionSummary[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try { setVersions((await listLongEpisodeVideoVersions(projectId, episodeNumber, sceneNumber)).versions); }
    catch { /* The card works without it; a history that cannot be listed is not worth an alarm here. */ }
  }
  useEffect(() => { void load(); }, [projectId, episodeNumber, sceneNumber]);

  async function restore(versionId: string): Promise<void> {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await restoreLongEpisodeVideoVersion(projectId, episodeNumber, sceneNumber, versionId);
      setConfirm(null);
      onRestored(response.episode);
      await load();
    } catch (caught) { setError(toLongProjectDisplayError(caught).message); }
    finally { setBusy(false); }
  }

  if (versions.length <= 1) return null;
  /* `isCurrent`, not the first row: after a restore the clip in use is not the newest one. */
  const past = versions.filter((version) => !version.isCurrent);

  return (
    <details data-testid={`episode-video-versions-${sceneNumber}`} className="rounded-lg border border-white/10 bg-slate-950/40">
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400">이전 판 {past.length}개</summary>
      <ul className="space-y-2 px-3 pb-3">
        {past.map((version) => (
          <li key={version.versionId} data-testid={`episode-video-version-${sceneNumber}-${version.versionId}`} className="space-y-1.5 rounded-lg border border-white/10 p-2">
            <p className="text-xs text-slate-400 tabular-nums">{dateLabel(version.createdAt)} · {sizeLabel(version.bytes)}</p>
            <video
              data-testid={`episode-video-version-player-${sceneNumber}-${version.versionId}`}
              className="w-full rounded border border-white/10 bg-black"
              controls
              preload="none"
              src={longEpisodeVideoVersionContentUrl(projectId, episodeNumber, sceneNumber, version.versionId)}
            />
            <button type="button" data-testid={`episode-video-version-restore-${sceneNumber}-${version.versionId}`} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50" disabled={busy} onClick={() => setConfirm(version.versionId)}>
              이 판으로 되돌리기
            </button>
            {confirm === version.versionId && (
              /* The cost of this button is not money — it is the merged Episode. Said before the press, because
                 afterwards the person finds out by discovering their final video is gone. */
              <div role="alertdialog" data-testid={`episode-video-version-confirm-${sceneNumber}-${version.versionId}`} className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-2.5">
                <p className="text-xs text-amber-200">
                  이 판으로 되돌립니다. 비용은 들지 않고 지금 쓰는 영상도 보관되니 언제든 되돌아올 수 있습니다.
                  다만 <strong className="text-amber-100">이미 만든 최종 영상은 무효가 되어 다시 합쳐야 합니다</strong> — 장면이 바뀌기 때문입니다.
                </p>
                <div className="flex gap-2">
                  <button type="button" className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5" disabled={busy} onClick={() => setConfirm(null)}>돌아가기</button>
                  <button type="button" data-testid={`episode-video-version-confirm-yes-${sceneNumber}-${version.versionId}`} className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void restore(version.versionId)}>되돌립니다</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" data-testid={`episode-video-version-error-${sceneNumber}`} className="px-3 pb-3 text-xs text-rose-400">{error}</p>}
    </details>
  );
}
