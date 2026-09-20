import { useEffect, useState } from "react";
import type { ProjectSummary } from "@ai-animation-studio/shared";

import { listProjects, toDisplayError } from "../api/projectsApi.js";
import { Spinner } from "./Spinner.js";
import { ProjectFrame } from "./ProjectList.js";
import { primaryButton } from "./ui/surfaces.js";

interface Props {
  onBack: () => void;
  /** 새 카드를 만들러 가는 곳. */
  onCreateNew: () => void;
  /** 이미 있는 카드가 열리는 곳. */
  onOpenCard: (projectId: string) => void;
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
 * 명언 카드의 첫 화면 — **만들어 둔 카드**.
 *
 * 🔴 왜 갈랐나: 전까지 이 메뉴를 누르면 **만든 카드 목록 + 그림 고르기 + 문장 + 길이 + 이름 + 만들기**가
 * 한 화면에 다 있었습니다. 캡틴D께서 *「지금 바로 명언 카드 들어가면 너무 복잡해」*라고 하셨고, 맞습니다 —
 * **예전 카드 한 장 보려고 들어가도 만들기 폼을 전부 지나가야** 했습니다. 두 화면은 하는 일이 다릅니다:
 * 하나는 **찾는** 곳이고 하나는 **만드는** 곳입니다.
 *
 * 🟠 그리고 단기 프로젝트가 이미 이 모양입니다(목록이 먼저, 「새 프로젝트」가 버튼). 같은 종류의 화면이
 * 서로 다른 모양이면, 사이드바에서 한 칸 옮겼을 뿐인데 다른 앱에 온 것처럼 읽힙니다.
 *
 * 🟢 프레임은 `ProjectList` 의 것을 **그대로 씁니다.** 카드도 결국 같은 프로젝트라, 사본을 만들면
 * 「완료는 이렇게 보인다」가 두 곳에서 갈립니다.
 */
export function PhotoCardListScreen({ onBack, onCreateNew, onOpenCard }: Props) {
  const [cards, setCards] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((response) => { if (!cancelled) setCards(response.projects.filter((project) => project.photoCard === true)); })
      .catch((caught: unknown) => { if (!cancelled) setError(toDisplayError(caught)); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section>
      {/* 단기 프로젝트와 같은 머리글 — 숫자를 표본으로 세우고, 그 옆에 화면 이름. */}
      <header className="flex items-end gap-5">
        <div className="flex items-baseline gap-4">
          <span data-testid="photo-card-count" className="type-display text-[58px] leading-[0.82] text-bone">
            {cards?.length ?? 0}
          </span>
          <div className="flex flex-col gap-0.5 pb-0.5">
            <span aria-hidden="true" className="type-index text-bone-faint">Quote cards</span>
            <h1 className="text-[17px] font-medium tracking-[-0.01em] text-bone-dim">명언 카드</h1>
          </div>
        </div>
        <button type="button" data-testid="photo-card-new" className={`${primaryButton} ml-auto flex items-center gap-1.5 text-[13px]`} onClick={onCreateNew}>
          <PlusIcon />
          새 카드
        </button>
      </header>

      <div className="mt-6 border-b border-line" />

      {cards === null && !error && <Spinner label="불러오는 중..." className="mt-6" />}

      {/*
        * 🔴 이 오류를 삼키지 않습니다. 카드는 **이 화면 말고 어디에도 안 실립니다**(단기 프로젝트에서 뺐습니다).
        * 목록을 못 읽은 걸 조용히 넘기면 화면이 「카드가 없다」고 말하는 것과 **똑같이 보이고**, 그러면 사람이
        * 이미 만든 카드를 다시 만듭니다.
        */}
      {error && (
        <p role="alert" data-testid="photo-card-existing-error" data-error-code={error.code} className="mt-6 text-sm text-rose-400">
          {error.message} — 만들어 둔 카드 목록을 불러오지 못했습니다. 새로 만드는 것은 그대로 됩니다.
        </p>
      )}

      {cards !== null && cards.length === 0 && (
        <p className="mt-6 text-bone-dim" data-testid="photo-card-none">
          아직 만든 카드가 없습니다. 오른쪽 위 「새 카드」로 시작하세요.
        </p>
      )}

      {cards !== null && cards.length > 0 && (
        <ul data-testid="photo-card-existing" className="mt-6 grid grid-cols-2 gap-x-8 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {cards.map((card, index) => (
            <li key={card.id}>
              <ProjectFrame testId={`photo-card-open-${card.id}`} project={card} index={index} onOpen={() => onOpenCard(card.id)} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-9 border-t border-line pt-3 text-[11px] text-bone-faint">
        보관함의 그림에 문장을 얹어 짧은 영상으로 만듭니다. 그림은 이미 만들어 둔 것을 그대로 쓰기 때문에 여기서는 돈이 나가지 않습니다.
      </p>

      <button type="button" data-testid="photo-card-list-back" className="mt-6 text-xs text-bone-dim transition-colors hover:text-bone" onClick={onBack}>
        <span aria-hidden="true">←</span> 프로젝트 목록으로
      </button>
    </section>
  );
}
