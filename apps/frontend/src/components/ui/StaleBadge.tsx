import type { SceneNumber } from "@ai-animation-studio/shared";

type StaleKind = "image" | "video" | "narration";

interface StaleBadgeProps {
  /** The scene numbers the server reported as stale for this artifact kind; absent when the server sent none. */
  staleSceneNumbers: SceneNumber[] | undefined;
  sceneNumber: SceneNumber;
  kind: StaleKind;
  "data-testid"?: string;
}

const KIND_LABEL: Record<StaleKind, string> = {
  image: "이미지",
  video: "영상",
  narration: "음성",
};

/**
 * Marks one scene's already-generated artifact as behind the scene's current text.
 *
 * "Stale" is strictly narrower than "missing": the server only lists a scene here when that artifact was
 * actually generated at some point and its recorded inputs no longer match the scene's current fields. A scene
 * that was never generated is simply absent from the list, and the surrounding screen already shows that as an
 * empty slot — conflating the two would tell the user to "regenerate" something that does not exist yet.
 *
 * Deliberately says *why* rather than just "stale": the user edited a scene at some earlier point, and by the
 * time they reach this screen the connection between that edit and this badge is not obvious.
 */
export function StaleBadge({ staleSceneNumbers, sceneNumber, kind, "data-testid": testId }: StaleBadgeProps) {
  if (!staleSceneNumbers?.includes(sceneNumber)) return null;
  return (
    <span
      data-testid={testId}
      data-stale-kind={kind}
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300"
      title={`장면 내용이 바뀐 뒤로 이 ${KIND_LABEL[kind]}을(를) 다시 만들지 않았습니다.`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      내용 바뀜 · {KIND_LABEL[kind]} 다시 필요
    </span>
  );
}
