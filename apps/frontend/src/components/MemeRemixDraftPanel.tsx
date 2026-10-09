import { useRef, useState, type FormEvent } from "react";
import { MAX_SCENE_COUNT, MIN_SCENE_COUNT, type MemeObservationCard, type MemeTrend, type Project } from "@ai-animation-studio/shared";

import { createProject, toDisplayError } from "../api/projectsApi.js";
import { isSafeProjectId } from "../validation/projectId.js";
import { primaryButton } from "./ui/surfaces.js";

interface Props {
  trend: MemeTrend;
  cards: MemeObservationCard[];
  onCreated: (project: Project) => void;
}

const inputClass = "mt-1 w-full rounded border border-line bg-slate-900/70 px-3 py-2 text-sm text-bone focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

export function cardHint(card: MemeObservationCard): string {
  const label = { line: "말", gesture: "동작", timing: "타이밍" }[card.kind];
  return `${label}: ${card.text}`;
}

export function defaultBeat(index: number, count: number, cards: MemeObservationCard[]): string {
  if (index === 0) return "새 캐릭터가 새로운 상황에 등장해 짧고 분명한 목표를 세운다.";
  const middleCount = Math.max(1, count - 2);
  const source = cards.filter((_, cardIndex) => Math.floor(cardIndex * middleCount / cards.length) === Math.min(index - 1, middleCount - 1));
  const pattern = source.map(cardHint).join(" / ");
  if (index === count - 1) return `${count === 2 ? `관찰 패턴(${pattern})을 새 말과 행동으로 바꾼 뒤, ` : "앞선 변화가 뜻밖의 결과를 낳고, "}캐릭터의 선택으로 짧게 마무리한다.`;
  return `관찰 패턴(${pattern})의 리듬만 참고해 이 상황에 맞는 새 말·행동으로 바꾼다.`;
}

/** The editable plan is local until Create is pressed. No Provider call occurs in this component. */
export function MemeRemixDraftPanel({ trend, cards, onCreated }: Props) {
  const initialCount = Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, cards.length + 2));
  const [projectId, setProjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [character, setCharacter] = useState("");
  const [situation, setSituation] = useState("");
  const [beats, setBeats] = useState(() => Array.from({ length: initialCount }, (_, index) => defaultBeat(index, initialCount, cards)));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  function changeCount(raw: string): void {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) return;
    const count = Math.min(MAX_SCENE_COUNT, Math.max(MIN_SCENE_COUNT, parsed));
    setBeats((old) => Array.from({ length: count }, (_, index) => old[index] ?? defaultBeat(index, count, cards)));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy.current) return;
    if (!projectId.trim() || !isSafeProjectId(projectId.trim())) { setError("폴더 이름은 한글·영문·숫자·_·-만 쓸 수 있고 띄어쓰기는 쓸 수 없습니다."); return; }
    if (!topic.trim() || !character.trim() || !situation.trim() || beats.some((beat) => !beat.trim())) {
      setError("주제·캐릭터·새 상황과 모든 장면 계획을 적어 주세요.");
      return;
    }
    const fullStory = [
      `새 캐릭터: ${character.trim()}`,
      `새 상황: ${situation.trim()}`,
      ...beats.map((beat, index) => `${index + 1}장면: ${beat.trim()}`),
    ].join("\n");
    const additionalNotes = [
      `밈 관찰 카드 참고: ${trend.name}`,
      ...cards.map((card) => `- ${cardHint(card)}`),
      "원본 영상·음원·대사·로고·얼굴을 복제하지 마세요. 관찰한 리듬과 구조만 참고해 새 캐릭터·배경·말·행동으로 바꿔 주세요.",
    ].join("\n");
    if (fullStory.length > 6000 || additionalNotes.length > 6000) { setError("장면 계획이나 관찰 카드가 너무 깁니다. 글을 줄여 주세요."); return; }
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await createProject({
        projectId: projectId.trim(), topic: topic.trim(),
        initialStoryDraft: { projectName: topic.trim(), character: character.trim(), fullStory, additionalNotes, sceneCount: beats.length },
      });
      onCreated(response.project);
    } catch (caught) {
      setError(toDisplayError(caught).message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <form data-testid="meme-remix-draft" onSubmit={(event) => void submit(event)} className="mt-5 space-y-4 rounded-lg border border-line bg-ground-raised p-5" noValidate>
      <div>
        <h3 className="text-base font-semibold text-bone">내 캐릭터로 애니메이션 초안 만들기</h3>
        <p className="mt-1 text-xs text-bone-dim">저장한 관찰 카드 {cards.length}장을 참고해 장면 계획을 먼저 고칩니다. 프로젝트 생성만으로 AI·영상 유료 요청은 나가지 않습니다.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs text-bone-dim">프로젝트 폴더 이름
          <input className={inputClass} value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={saving} />
        </label>
        <label className="text-xs text-bone-dim">새 영상 주제
          <input className={inputClass} value={topic} onChange={(event) => setTopic(event.target.value)} disabled={saving} maxLength={200} />
        </label>
        <label className="text-xs text-bone-dim">내 캐릭터
          <input className={inputClass} value={character} onChange={(event) => setCharacter(event.target.value)} disabled={saving} maxLength={200} />
        </label>
        <label className="text-xs text-bone-dim">새로운 상황·배경
          <input className={inputClass} value={situation} onChange={(event) => setSituation(event.target.value)} disabled={saving} maxLength={200} />
        </label>
      </div>
      <label className="block max-w-40 text-xs text-bone-dim">장면 수 (2–12)
        <input className={inputClass} type="number" min={MIN_SCENE_COUNT} max={MAX_SCENE_COUNT} value={beats.length} onChange={(event) => changeCount(event.target.value)} disabled={saving} />
      </label>
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-bone">장면 계획 · 전부 수정할 수 있습니다</h4>
        {beats.map((beat, index) => (
          <label key={index} className="block text-xs text-bone-dim">{index + 1}장면
            <textarea className={inputClass} rows={2} value={beat} maxLength={350} onChange={(event) => setBeats((old) => old.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} disabled={saving} />
          </label>
        ))}
      </div>
      <p className="text-xs text-bone-faint">만든 뒤 기존 단기 프로젝트 설정에서 내용을 다시 확인하고, 대본 승인 화면에서 비용을 확인합니다.</p>
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      <button type="submit" className={primaryButton} disabled={saving}>{saving ? "프로젝트 만드는 중…" : "이 계획으로 단기 프로젝트 만들기"}</button>
    </form>
  );
}
