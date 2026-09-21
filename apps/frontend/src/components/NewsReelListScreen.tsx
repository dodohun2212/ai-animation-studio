import { useEffect, useState } from "react";
import type { ProjectSummary } from "@ai-animation-studio/shared";

import { listProjects, toDisplayError } from "../api/projectsApi.js";
import { Spinner } from "./Spinner.js";
import { ProjectFrame } from "./ProjectList.js";
import { primaryButton } from "./ui/surfaces.js";

interface Props {
  onBack: () => void;
  /** 새 릴을 쓰러 가는 곳 — 기사에서 네 줄을 뽑는 화면. */
  onCreateNew: () => void;
  onOpenReel: (projectId: string) => void;
}

type DisplayError = { code: string; message: string };

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * 뉴스 릴의 첫 화면 — **만들어 둔 릴**.
 *
 * 🔴 **이 화면이 없으면 만든 릴이 사라집니다.** 릴은 단기 프로젝트에서 빠졌고(그 목록의 단계 표시는 릴에
 * 없는 단계를 셉니다), 명언 카드 목록은 `photoCard === true` 만 담습니다 — 그래서 **아무 목록에도 안
 * 실립니다.** 명언 카드가 갈릴 때 목록과 만들기가 **같이** 움직인 것과 같은 이유입니다(ProjectList 주석).
 *
 * 🟠 캡틴D: *「이건 뉴스 릴로 만들었는데 왜 명언 카드에 있는거야」* — 그 전까지 뉴스 릴이 **명언 카드 화면으로
 * 넘어가** 만들어졌기 때문입니다. 지금은 릴이 자기 길로 만들어지고, 여기 실립니다.
 *
 * 🟢 프레임은 `ProjectList` 의 것을 그대로 씁니다 — 릴도 결국 같은 프로젝트라, 사본을 만들면 「완료는 이렇게
 * 보인다」가 두 곳에서 갈립니다.
 */
export function NewsReelListScreen({ onBack, onCreateNew, onOpenReel }: Props) {
  const [reels, setReels] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      /* 🔴 `newsReelCard !== undefined` — 깃발이 아니라 **카드가 있느냐**입니다. 서버가 묻는 것과 같습니다. */
      .then((response) => { if (!cancelled) setReels(response.projects.filter((project) => project.newsReelCard !== undefined)); })
      .catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section>
      <header className="flex items-end gap-5">
        <div className="flex items-baseline gap-4">
          <span data-testid="news-reel-count" className="type-display text-[58px] leading-[0.82] text-bone">
            {reels?.length ?? 0}
          </span>
          <div className="flex flex-col gap-0.5 pb-0.5">
            <span aria-hidden="true" className="type-index text-bone-faint">News reels</span>
            <h1 className="text-[17px] font-medium tracking-[-0.01em] text-bone-dim">뉴스 릴</h1>
          </div>
        </div>
        <button type="button" data-testid="news-reel-new" className={`${primaryButton} ml-auto flex items-center gap-1.5 text-[13px]`} onClick={onCreateNew}>
          <PlusIcon />
          새 릴
        </button>
      </header>

      <div className="mt-6 border-b border-line" />

      {reels === null && !error && <Spinner label="불러오는 중..." className="mt-6" />}

      {/* 🔴 삼키지 않습니다 — 「못 읽었다」와 「없다」가 같아 보이면, 사람이 이미 만든 릴을 다시 만듭니다. */}
      {error && (
        <p role="alert" data-testid="news-reel-list-error" data-error-code={error.code} className="mt-6 text-sm text-rose-400">
          {error.message} — 만들어 둔 릴 목록을 불러오지 못했습니다. 새로 만드는 것은 그대로 됩니다.
        </p>
      )}

      {reels !== null && reels.length === 0 && (
        <p className="mt-6 text-bone-dim" data-testid="news-reel-none">
          아직 만든 릴이 없습니다. 오른쪽 위 「새 릴」로 시작하세요.
        </p>
      )}

      {reels !== null && reels.length > 0 && (
        <ul data-testid="news-reel-existing" className="mt-6 grid grid-cols-2 gap-x-8 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {reels.map((reel, index) => (
            <li key={reel.id}>
              <ProjectFrame testId={`news-reel-open-${reel.id}`} project={reel} index={index} onOpen={() => onOpenReel(reel.id)} />
              {/* 🟠 제목 첫 줄을 이름 밑에 적습니다 — 릴 이름은 사람이 붙인 것이라 **무슨 기사였는지**를 말하지 않습니다. */}
              <p className="mt-1 truncate text-[11px] text-bone-faint" data-testid={`news-reel-headline-${reel.id}`}>
                {reel.newsReelCard?.headline.line1}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-9 border-t border-line pt-3 text-[11px] text-bone-faint">
        기사에서 제목 두 줄과 자막을 뽑아, 보관함 그림 위에 띠와 함께 굽습니다. 기사 사진은 쓰지 않습니다.
      </p>

      <button type="button" data-testid="news-reel-list-back" className="mt-6 text-xs text-bone-dim transition-colors hover:text-bone" onClick={onBack}>
        <span aria-hidden="true">←</span> 프로젝트 목록으로
      </button>
    </section>
  );
}
