import { useEffect, useState } from "react";
import type { GeneratedEpisodeImageSummary, GeneratedImageSummary } from "@ai-animation-studio/shared";

import { generatedEpisodeImageContentUrl, generatedImageContentUrl, getGeneratedImages, toGeneratedImagesDisplayError } from "../api/generatedImagesApi.js";

type DisplayError = { code: string; message: string };

function dateLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString("ko-KR", { dateStyle: "short" });
}

/**
 * The pictures this app has made, gathered from every project.
 *
 * They were only ever reachable through the project that made them, so finding "that drawing from a while
 * back" meant remembering which project it was in first. Nothing moves: the files stay where each project
 * keeps them (their absolute paths are recorded in the project file, so moving them would strand the project),
 * and this only reads a listing and points at the addresses the review screens already use.
 *
 * Viewing only — no editing, no deleting. That was the agreed scope.
 */
export function GeneratedImagesSection() {
  const [projects, setProjects] = useState<readonly GeneratedImageSummary[]>([]);
  const [episodes, setEpisodes] = useState<readonly GeneratedEpisodeImageSummary[]>([]);
  const [error, setError] = useState<DisplayError | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGeneratedImages()
      .then((response) => {
        if (cancelled) return;
        setProjects(response.projects);
        setEpisodes(response.episodes);
      })
      .catch((caught: unknown) => { if (!cancelled) setError(toGeneratedImagesDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const total = projects.length + episodes.length;
  /* Nothing at all until there is something to show: a heading for pictures you have not made yet is the kind
     of length this app was asked to lose. An error is worth a line, though — silence would read as "none". */
  if (!loaded || (total === 0 && !error)) return null;

  return (
    <details data-testid="generated-images" className="rounded-2xl border border-white/10 bg-slate-900/70">
      {/* The split is named before the list opens. It used to say only the total, and the short project's grid
          is what appears first — so someone looking for an Episode's pictures scanned that grid, did not find
          them, and concluded the library had never collected them. They were four rows further down. A count
          that hides which kinds it is counting answers a question nobody asked. */}
      <summary className="cursor-pointer px-5 py-4 text-base font-semibold text-slate-100">
        만든 이미지 {total}장
        {Boolean(projects.length) && Boolean(episodes.length) && (
          <span data-testid="generated-images-split" className="ml-2 text-sm font-normal text-slate-400 tabular-nums">
            단편 {projects.length} · 장기 회차 {episodes.length}
          </span>
        )}
      </summary>
      <div className="space-y-4 px-5 pb-5">
        <p className="text-sm text-slate-400">
          프로젝트에서 만들어진 장면 이미지입니다. 파일은 각 프로젝트에 그대로 있고, 여기서는 모아서 보기만 합니다.
        </p>
        {error && (
          <p role="alert" data-testid="generated-images-error" data-error-code={error.code} className="text-sm text-rose-400">
            {error.message}
          </p>
        )}
        {Boolean(projects.length) && (
          <div className="space-y-2">
            {/* Headed only when the other group exists: with one kind on screen a heading is noise, and with
                both an unlabelled first grid reads as "all of them". */}
            {Boolean(episodes.length) && <h3 className="text-sm font-semibold text-slate-200">단편 프로젝트</h3>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="generated-images-projects">
            {projects.map((image) => (
              <li key={`${image.projectId}-${image.sceneNumber}`} data-testid={`generated-image-${image.projectId}-${image.sceneNumber}`} className="space-y-1">
                <img
                  src={generatedImageContentUrl(image)}
                  alt={`${image.projectTitle} ${image.sceneNumber}번 장면`}
                  className="w-full rounded-lg border border-white/10 object-cover"
                />
                <span className="block truncate text-xs text-slate-300">{image.projectTitle}</span>
                <span className="block text-xs text-slate-500 tabular-nums">{image.sceneNumber}번 장면 · {dateLabel(image.updatedAt)}</span>
              </li>
            ))}
          </ul>
          </div>
        )}
        {Boolean(episodes.length) && (
          <div className="space-y-2" data-testid="generated-images-episodes">
            <h3 className="text-sm font-semibold text-slate-200">장기 프로젝트 회차</h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {episodes.map((image) => (
                <li key={`${image.projectId}-${image.episodeNumber}-${image.sceneNumber}`} data-testid={`generated-episode-image-${image.projectId}-${image.episodeNumber}-${image.sceneNumber}`} className="space-y-1">
                  <img
                    src={generatedEpisodeImageContentUrl(image)}
                    alt={`${image.projectTitle} ${image.episodeNumber}화 ${image.sceneNumber}번 장면`}
                    className="w-full rounded-lg border border-white/10 object-cover"
                  />
                  <span className="block truncate text-xs text-slate-300">{image.projectTitle} · {image.episodeNumber}화</span>
                  <span className="block text-xs text-slate-500 tabular-nums">{image.sceneNumber}번 장면 · {dateLabel(image.updatedAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
