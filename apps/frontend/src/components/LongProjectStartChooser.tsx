import { ScreenHeader } from "./ui/ScreenHeader.js";
import { outlineButton, primaryButton } from "./ui/surfaces.js";

interface Props {
  /** 「직접 설정」으로 시작 — 제목·줄거리·회차 수를 손으로 적는 기존 생성 화면. */
  onStartDirect: () => void;
  /** 「소설에서 시작」 — 이야기 만들기. 소설을 넣고 AI가 줄거리·인물·회차를 정리하게 할 수 있다. */
  onStartFromStory: () => void;
  onBack: () => void;
}

/**
 * 새 작품 만들기 — **장기 프로젝트를 만드는 두 가지 시작 방법**을 한 곳에서 고릅니다.
 *
 * 🔴 「이야기 만들기」는 별개 제품이 아니라 장기 프로젝트의 **앞문**입니다(docs/08). 사이드바에 독립 항목으로 놓으면
 * 사람이 「이야기 만들기」와 「장기 프로젝트」를 서로 다른 것으로 읽고, 만든 뒤 나타나는 「작품 기본 설정」이 또 다른 곳으로
 * 보입니다(캡틴D 실사용 혼란, CLI 1326·1327). 그래서 두 방법을 같은 자리에 나란히 두고, 둘 다 같은 작품 작업공간으로
 * 합류한다고 첫 화면에서 말합니다.
 */
export function LongProjectStartChooser({ onStartDirect, onStartFromStory, onBack }: Props) {
  return (
    <section className="space-y-6">
      <ScreenHeader
        eyebrow="장기 프로젝트"
        title="새 작품 만들기"
        description="회차로 이어지는 작품(장기 프로젝트)을 만듭니다. 시작하는 방법만 다르고, 어느 쪽으로 만들어도 같은 작품 작업공간 — 작품 한눈에 보기·작품 기본 설정·회차·인물·영상 — 으로 이어집니다."
        backLabel="장기 프로젝트 목록으로"
        onBack={onBack}
        className="mt-8"
      />

      <ul className="grid gap-4 md:grid-cols-2" data-testid="long-start-methods">
        <li className="flex flex-col gap-3 rounded-lg border border-line bg-ground-raised p-5">
          <h2 className="text-base font-semibold text-bone">직접 설정으로 시작</h2>
          <p className="flex-1 text-xs leading-relaxed text-bone-dim">
            폴더 이름·제목·한 줄 줄거리·회차 수를 직접 적어 작품을 만듭니다. 만든 뒤 「회차 나누기(AI)」에서 회차 개요를 만듭니다.
            소설이 없거나 줄거리를 이미 정해 두었을 때 맞습니다.
          </p>
          <button type="button" data-testid="long-start-direct" className={outlineButton} onClick={onStartDirect}>직접 설정으로 시작</button>
        </li>
        <li className="flex flex-col gap-3 rounded-lg border border-line bg-ground-raised p-5">
          <h2 className="text-base font-semibold text-bone">소설에서 시작 (이야기 만들기)</h2>
          <p className="flex-1 text-xs leading-relaxed text-bone-dim">
            소설이나 이야기를 붙여넣어 시작합니다. AI가 읽어 줄거리·인물·회차 구성을 정리하게 할 수 있고(유료 분석, 선택),
            정리된 것을 고쳐서 확정하면 회차 개요와 인물이 채워진 작품이 만들어집니다. 직접 쓴 글이거나 이용 허락을 받은 글이어야 합니다.
          </p>
          <button type="button" data-testid="long-start-story" className={primaryButton} onClick={onStartFromStory}>소설에서 시작</button>
        </li>
      </ul>

      <p className="text-xs text-bone-faint" data-testid="long-start-merge">
        두 방법으로 만든 작품은 모두 같은 장기 프로젝트입니다 → 작품 한눈에 보기 → 회차별 대본 → 그림 → 영상 → 병합. 만든 뒤 「작품 기본 설정」은 그 작품의 수정 화면입니다.
      </p>
    </section>
  );
}
