/**
 * The two things a script model must know about the motion fields, in one place because two paths ask for them.
 *
 * A short project's fields come from `prompts/story/story_generation.txt`; a long project's Episode script comes
 * from `episode-scripts.service.ts`'s inline prompt. Episode 6 scene 6 failed at Runway on 2026-09-06 and the
 * first fix went into the template — which that Episode does not read. The place that was fixed and the place
 * that broke were different ones, and both were green.
 *
 * So the sentences live here and the template is checked against them (motion-field-rules.test.ts). A `.txt`
 * cannot import a constant, but it can be held to one.
 *
 * Why each exists:
 *
 * The length was only ever stated on the narration line, so the motion fields were written without knowing how
 * long the shot they become is. Nothing capped what could be asked of five seconds because nothing said there
 * were five — scene 6 asked for two camera moves and three deformations of a face.
 *
 * The stability rule is appended to every video request by `promptFor` (see STABILITY_RULE), and the model that
 * writes the motion never sees it. Scene 6's end_motion was a face being swallowed by glitch, sent under a line
 * demanding stable anatomy. Neither author was wrong on its own; they were never shown to each other.
 */
export function shotBudgetRule(clipDurationSeconds: number): string {
  return `움직임 항목(start_motion·main_motion·end_motion·camera_motion·environment_motion)은 장면당 ${clipDurationSeconds}초짜리 연속된 한 컷으로 만들어집니다. 시작 자세와 종료 자세 사이에 주요 동작 하나와 카메라 이동 하나가 들어갈 분량으로 쓰고, 한 컷에 여러 동작이나 여러 번의 카메라 전환을 넣지 마십시오.`;
}

/** The other half: what the video request will demand of whatever the motion fields describe. */
export const SUBJECT_SURVIVES_RULE = "영상 생성 요청은 인물의 정체성·신체·의상이 컷 내내 유지되도록 함께 요구합니다. 그러므로 얼굴이나 신체가 부서지거나 다른 것으로 바뀌거나 사라지는 변화는 움직임 항목에 쓰지 마십시오. 그런 사건이 이야기에 필요하면 description에 서술하고, 움직임 항목에는 그 직전까지의 동작만 쓰십시오.";

/** The placeholder the story template writes instead of a number, so the check can render one from the other. */
export const CLIP_DURATION_PLACEHOLDER = "$clip_duration_seconds";
