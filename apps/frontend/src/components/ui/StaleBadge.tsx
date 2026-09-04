import type { SceneNumber } from "@ai-animation-studio/shared";

type StaleKind = "image" | "style" | "video" | "format" | "narration" | "reference";

interface StaleBadgeProps {
  /** The scene numbers the server reported as stale for this artifact kind; absent when the server sent none. */
  staleSceneNumbers: SceneNumber[] | undefined;
  sceneNumber: SceneNumber;
  kind: StaleKind;
  "data-testid"?: string;
}

/**
 * `reference`, `style` and `format` are the kinds whose cause is not the scene's own text.
 *
 * The other three mean "you edited this scene and did not remake this". A reference goes stale when the
 * character behind the picture changed — a different folder mapped, its representative drawing replaced, a
 * version bumped — while the scene's words stayed exactly as they were. A `style` badge means the four
 * project-wide visual-style boxes were saved, which rewrites one line of every scene's prompt at once; the
 * scene it is attached to may never have been opened. `format` is the same story for video: the clip length
 * and the orientation are project settings and they open every video prompt, so changing one puts every
 * generated clip behind at once. Telling someone their text changed when it did not sends them to re-read a
 * scene that is fine, so these kinds get their own sentences.
 */
const KIND_SENTENCE: Record<StaleKind, string> = {
  image: "장면 내용이 바뀐 뒤로 이 이미지를 다시 만들지 않았습니다.",
  style: "그림 방향 설정이 바뀐 뒤로 이 이미지를 다시 만들지 않았습니다. 장면 내용은 그대로입니다.",
  video: "장면 내용이 바뀐 뒤로 이 영상을 다시 만들지 않았습니다.",
  format: "영상 길이나 화면 방향 설정이 바뀐 뒤로 이 영상을 다시 만들지 않았습니다. 장면 내용은 그대로입니다.",
  narration: "장면 내용이 바뀐 뒤로 이 음성을 다시 만들지 않았습니다.",
  reference: "이 그림을 만든 뒤로 참고 이미지가 바뀌었습니다. 장면 내용은 그대로입니다.",
};

const KIND_TEXT: Record<StaleKind, string> = {
  image: "내용 바뀜 · 이미지 다시 필요",
  style: "그림 방향 바뀜 · 이미지 다시 필요",
  video: "내용 바뀜 · 영상 다시 필요",
  format: "영상 길이·방향 바뀜 · 영상 다시 필요",
  narration: "내용 바뀜 · 음성 다시 필요",
  reference: "참고 이미지 바뀜",
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
      title={KIND_SENTENCE[kind]}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {KIND_TEXT[kind]}
    </span>
  );
}
